// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  DomainGuard
 * @notice A decentralized domain registry that requires M-of-N admin approval
 *         before any critical operation (transfer, DNS update, freeze, admin
 *         replacement) can be executed.
 *
 * @dev    KEY DESIGN DECISIONS (for hackathon judges):
 *         - There is NO owner, NO superuser, NO upgrade proxy.
 *           Every change goes through the proposal → approve → execute flow.
 *         - The contract itself HOLDS the domain state and ENFORCES the rules.
 *           Removing it and using a plain database would destroy the guarantees.
 *         - A time-lock delay protects non-emergency operations: even if 3 of 5
 *           admins are compromised simultaneously, honest participants have a
 *           window to cancel the proposal before it executes.
 *         - Emergency FREEZE only needs 2 approvals and no time-lock, because
 *           speed matters when a domain is under attack.
 */
contract DomainGuard {

    // =========================================================================
    // CONSTANTS & IMMUTABLES
    // =========================================================================

    /// @notice Number of approvals needed for most critical operations.
    uint256 public constant THRESHOLD = 3;

    /// @notice Reduced threshold for emergency freeze (speed matters).
    uint256 public constant FREEZE_THRESHOLD = 2;

    /// @notice Total number of admins in the system.
    uint256 public constant ADMIN_COUNT = 5;

    /// @notice Seconds that must pass after threshold is reached before execute().
    ///         Set to a small value (e.g. 60) for demo purposes.
    uint256 public immutable timeLockDelay;

    // =========================================================================
    // ENUMS
    // =========================================================================

    /**
     * @notice All supported proposal types.
     * @dev    TRANSFER_OWNERSHIP  — move domain to a new Ethereum address
     *         UPDATE_DNS          — change the DNS record string
     *         FREEZE_DOMAIN       — emergency lock (2-of-5, no time-lock)
     *         UNFREEZE_DOMAIN     — lift the lock (3-of-5, with time-lock)
     *         REPLACE_ADMIN       — swap a lost/compromised admin key (3-of-5)
     */
    enum ActionType {
        TRANSFER_OWNERSHIP,
        UPDATE_DNS,
        FREEZE_DOMAIN,
        UNFREEZE_DOMAIN,
        REPLACE_ADMIN
    }

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /**
     * @notice On-chain record for a registered domain.
     * @param  owner     Ethereum address that "owns" the domain.
     * @param  dnsRecord A plain-text DNS record (e.g. "A 93.184.216.34").
     * @param  frozen    When true, no transfers or DNS updates are allowed.
     * @param  exists    Guard flag so we can distinguish "never registered".
     */
    struct Domain {
        address owner;
        string  dnsRecord;
        bool    frozen;
        bool    exists;
    }

    /**
     * @notice A pending multi-sig proposal.
     * @param  actionType       What kind of operation this is.
     * @param  domainName       The domain this proposal targets.
     * @param  targetAddress    Used by TRANSFER_OWNERSHIP and REPLACE_ADMIN.
     * @param  newAdminAddress  For REPLACE_ADMIN: the replacement key.
     * @param  dnsRecord        Used by UPDATE_DNS.
     * @param  approvalCount    How many unique admin approvals collected so far.
     * @param  thresholdReachedAt  Timestamp when approvals first hit the threshold.
     *                          Zero means threshold not yet reached.
     * @param  executed         True once the proposal has been carried out.
     * @param  cancelled        True if the proposal was cancelled before execution.
     * @param  proposer         The admin who created this proposal.
     * @param  hasApproved      Maps each admin address → whether they approved.
     */
    struct Proposal {
        ActionType actionType;
        string     domainName;
        address    targetAddress;
        address    newAdminAddress;
        string     dnsRecord;
        uint256    approvalCount;
        uint256    thresholdReachedAt;
        bool       executed;
        bool       cancelled;
        address    proposer;
        mapping(address => bool) hasApproved;
    }

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice The five admin addresses.
    address[ADMIN_COUNT] public admins;

    /// @notice Quick lookup: is this address currently an admin?
    mapping(address => bool) public isAdmin;

    /// @notice All registered domains, keyed by domain name string.
    mapping(string => Domain) public domains;

    /// @notice All proposals ever created, indexed by proposal ID.
    ///         IDs are sequential: 0, 1, 2, …
    mapping(uint256 => Proposal) public proposals;

    /// @notice The next proposal ID to assign.
    uint256 public proposalCount;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /// @dev Emitted whenever a new proposal is created.
    event ActionProposed(
        uint256 indexed proposalId,
        ActionType      actionType,
        string          domainName,
        address indexed proposer
    );

    /// @dev Emitted whenever an admin approves a proposal.
    event ActionApproved(
        uint256 indexed proposalId,
        address indexed approver,
        uint256         newApprovalCount
    );

    /// @dev Emitted whenever a proposal is successfully executed.
    event ActionExecuted(
        uint256 indexed proposalId,
        ActionType      actionType,
        string          domainName
    );

    /// @dev Emitted whenever a proposal is cancelled.
    event ActionCancelled(
        uint256 indexed proposalId,
        address indexed cancelledBy
    );

    /// @dev Emitted when a domain's frozen status changes.
    event DomainFrozenStatus(
        string  domainName,
        bool    frozen
    );

    /// @dev Emitted when an admin key is replaced via REPLACE_ADMIN.
    event AdminReplaced(
        address indexed oldAdmin,
        address indexed newAdmin
    );

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    /**
     * @dev Reverts if the caller is not one of the five admins.
     *      This is the primary access-control gate.
     */
    modifier onlyAdmin() {
        require(isAdmin[msg.sender], "DomainGuard: caller is not an admin");
        _;
    }

    /**
     * @dev Reverts if the proposal ID does not exist.
     */
    modifier validProposal(uint256 proposalId) {
        require(proposalId < proposalCount, "DomainGuard: proposal does not exist");
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Deploy the contract, register five admin addresses, and
     *         register an initial domain for the demo.
     *
     * @param  _admins         Exactly 5 admin addresses (no duplicates, no zero address).
     * @param  _timeLockDelay  Seconds to wait after threshold is reached.
     *                         Use 60 for the demo.
     * @param  _initialDomain  A domain name to pre-register for demo purposes.
     * @param  _initialOwner   The initial owner address for that domain.
     * @param  _initialDns     The initial DNS record string.
     */
    constructor(
        address[ADMIN_COUNT] memory _admins,
        uint256 _timeLockDelay,
        string  memory _initialDomain,
        address _initialOwner,
        string  memory _initialDns
    ) {
        // Validate and store each admin address
        for (uint256 i = 0; i < ADMIN_COUNT; i++) {
            address a = _admins[i];
            require(a != address(0),  "DomainGuard: zero address not allowed");
            require(!isAdmin[a],      "DomainGuard: duplicate admin address");
            admins[i]  = a;
            isAdmin[a] = true;
        }

        timeLockDelay = _timeLockDelay;

        // Pre-register the initial domain so the demo has something to work with
        domains[_initialDomain] = Domain({
            owner:     _initialOwner,
            dnsRecord: _initialDns,
            frozen:    false,
            exists:    true
        });
    }

    // =========================================================================
    // EXTERNAL FUNCTIONS
    // =========================================================================

    /**
     * @notice Create a new proposal for a critical action.
     *
     * @dev    The proposer does NOT automatically approve their own proposal.
     *         They must call approve() separately just like every other admin.
     *         This makes the flow uniform and avoids hidden shortcuts.
     *
     * @param  actionType       The type of action being proposed.
     * @param  domainName       The domain this proposal targets.
     * @param  targetAddress    For TRANSFER_OWNERSHIP: the new owner.
     *                          For REPLACE_ADMIN:      the OLD admin to replace.
     * @param  newAdminAddress  For REPLACE_ADMIN: the NEW admin key.
     * @param  dnsRecord        For UPDATE_DNS: the new DNS string.
     */
    function proposeAction(
        ActionType actionType,
        string     calldata domainName,
        address    targetAddress,
        address    newAdminAddress,
        string     calldata dnsRecord
    )
        external
        onlyAdmin
        returns (uint256 proposalId)
    {
        // The domain must already be registered for most action types
        if (
            actionType != ActionType.REPLACE_ADMIN
        ) {
            require(domains[domainName].exists, "DomainGuard: domain not registered");
        }

        // For REPLACE_ADMIN, validate that targetAddress is actually an existing admin
        if (actionType == ActionType.REPLACE_ADMIN) {
            require(isAdmin[targetAddress],        "DomainGuard: target is not an admin");
            require(newAdminAddress != address(0), "DomainGuard: new admin is zero address");
            require(!isAdmin[newAdminAddress],     "DomainGuard: new admin already exists");
        }

        proposalId = proposalCount;
        proposalCount++;

        // Write proposal fields (mapping inside struct needs separate assignment)
        Proposal storage p = proposals[proposalId];
        p.actionType      = actionType;
        p.domainName      = domainName;
        p.targetAddress   = targetAddress;
        p.newAdminAddress = newAdminAddress;
        p.dnsRecord       = dnsRecord;
        p.proposer        = msg.sender;
        // approvalCount, thresholdReachedAt, executed, cancelled default to 0/false

        emit ActionProposed(proposalId, actionType, domainName, msg.sender);
    }

    /**
     * @notice Approve an existing, open proposal.
     *
     * @dev    Rules enforced here:
     *         1. Caller must be an admin.
     *         2. Proposal must not be executed or cancelled.
     *         3. Each admin can only approve once.
     *         4. For REPLACE_ADMIN, the admin being replaced cannot vote.
     *
     * @param  proposalId  The ID of the proposal to approve.
     */
    function approve(uint256 proposalId)
        external
        onlyAdmin
        validProposal(proposalId)
    {
        Proposal storage p = proposals[proposalId];

        require(!p.executed,  "DomainGuard: proposal already executed");
        require(!p.cancelled, "DomainGuard: proposal already cancelled");
        require(
            !p.hasApproved[msg.sender],
            "DomainGuard: admin already approved this proposal"
        );

        // REPLACE_ADMIN rule: the admin being replaced cannot vote on their own replacement
        if (p.actionType == ActionType.REPLACE_ADMIN) {
            require(
                msg.sender != p.targetAddress,
                "DomainGuard: replaced admin cannot approve their own replacement"
            );
        }

        p.hasApproved[msg.sender] = true;
        p.approvalCount++;

        emit ActionApproved(proposalId, msg.sender, p.approvalCount);

        // Check whether we've just crossed the required threshold
        uint256 required = _requiredApprovals(p.actionType);
        if (p.approvalCount == required && p.thresholdReachedAt == 0) {
            // Record the timestamp when the threshold was first reached.
            // This starts the time-lock countdown.
            p.thresholdReachedAt = block.timestamp;
        }
    }

    /**
     * @notice Execute a proposal once it has enough approvals and (for most
     *         types) the time-lock delay has expired.
     *
     * @dev    Any admin can call execute() — not just the proposer.
     *         This prevents a single admin from blocking execution by refusing
     *         to call this function.
     *
     * @param  proposalId  The ID of the proposal to execute.
     */
    function execute(uint256 proposalId)
        external
        onlyAdmin
        validProposal(proposalId)
    {
        Proposal storage p = proposals[proposalId];

        require(!p.executed,  "DomainGuard: proposal already executed");
        require(!p.cancelled, "DomainGuard: proposal already cancelled");

        uint256 required = _requiredApprovals(p.actionType);
        require(
            p.approvalCount >= required,
            "DomainGuard: not enough approvals"
        );

        // Time-lock check: FREEZE_DOMAIN skips this (emergency action).
        // Everything else must wait for the delay after the threshold was reached.
        if (p.actionType != ActionType.FREEZE_DOMAIN) {
            require(
                p.thresholdReachedAt != 0,
                "DomainGuard: threshold not yet reached"
            );
            require(
                block.timestamp >= p.thresholdReachedAt + timeLockDelay,
                "DomainGuard: time-lock period not yet over"
            );
        }

        p.executed = true;

        // Dispatch to the correct state-change handler
        if (p.actionType == ActionType.TRANSFER_OWNERSHIP) {
            _executeTransfer(p);
        } else if (p.actionType == ActionType.UPDATE_DNS) {
            _executeUpdateDns(p);
        } else if (p.actionType == ActionType.FREEZE_DOMAIN) {
            _executeFreeze(p);
        } else if (p.actionType == ActionType.UNFREEZE_DOMAIN) {
            _executeUnfreeze(p);
        } else if (p.actionType == ActionType.REPLACE_ADMIN) {
            _executeReplaceAdmin(p);
        }

        emit ActionExecuted(proposalId, p.actionType, p.domainName);
    }

    /**
     * @notice Cancel an open proposal.
     *
     * @dev    Only the proposer OR any admin can cancel (here we allow any admin
     *         to cancel, so the group retains control even if the proposer goes
     *         rogue after submitting). A proposal cannot be cancelled once
     *         executed.
     *
     * @param  proposalId  The ID of the proposal to cancel.
     */
    function cancel(uint256 proposalId)
        external
        onlyAdmin
        validProposal(proposalId)
    {
        Proposal storage p = proposals[proposalId];

        require(!p.executed,  "DomainGuard: proposal already executed");
        require(!p.cancelled, "DomainGuard: proposal already cancelled");

        p.cancelled = true;

        emit ActionCancelled(proposalId, msg.sender);
    }

    // =========================================================================
    // VIEW / HELPER FUNCTIONS
    // =========================================================================

    /**
     * @notice Return the approval count and status flags for a proposal.
     *         Useful for the frontend to display proposal state.
     */
    function getProposalStatus(uint256 proposalId)
        external
        view
        validProposal(proposalId)
        returns (
            uint256 approvalCount,
            bool    executed,
            bool    cancelled,
            uint256 thresholdReachedAt,
            bool    timeLockPassed
        )
    {
        Proposal storage p = proposals[proposalId];
        approvalCount      = p.approvalCount;
        executed           = p.executed;
        cancelled          = p.cancelled;
        thresholdReachedAt = p.thresholdReachedAt;

        // Tell the frontend whether the time-lock window is over yet
        if (p.thresholdReachedAt == 0) {
            timeLockPassed = false;
        } else if (p.actionType == ActionType.FREEZE_DOMAIN) {
            timeLockPassed = true; // freeze has no time-lock
        } else {
            timeLockPassed = block.timestamp >= p.thresholdReachedAt + timeLockDelay;
        }
    }

    /**
     * @notice Return the basic info for a proposal (excluding the mapping field).
     */
    function getProposalInfo(uint256 proposalId)
        external
        view
        validProposal(proposalId)
        returns (
            ActionType actionType,
            string memory domainName,
            address targetAddress,
            address newAdminAddress,
            string memory dnsRecord,
            address proposer
        )
    {
        Proposal storage p = proposals[proposalId];
        return (
            p.actionType,
            p.domainName,
            p.targetAddress,
            p.newAdminAddress,
            p.dnsRecord,
            p.proposer
        );
    }

    /**
     * @notice Check whether a specific admin has approved a specific proposal.
     */
    function hasAdminApproved(uint256 proposalId, address admin)
        external
        view
        validProposal(proposalId)
        returns (bool)
    {
        return proposals[proposalId].hasApproved[admin];
    }

    /**
     * @notice Return current domain state.
     */
    function getDomain(string calldata domainName)
        external
        view
        returns (address owner, string memory dnsRecord, bool frozen, bool exists)
    {
        Domain storage d = domains[domainName];
        return (d.owner, d.dnsRecord, d.frozen, d.exists);
    }

    /**
     * @notice Return all five admin addresses.
     */
    function getAdmins() external view returns (address[ADMIN_COUNT] memory) {
        return admins;
    }

    // =========================================================================
    // INTERNAL EXECUTION HELPERS
    // =========================================================================

    /**
     * @dev Transfer domain ownership to a new address.
     *      Reverts if the domain is frozen — frozen domains cannot move.
     */
    function _executeTransfer(Proposal storage p) internal {
        Domain storage d = domains[p.domainName];
        require(!d.frozen, "DomainGuard: domain is frozen, unfreeze first");
        d.owner = p.targetAddress;
    }

    /**
     * @dev Update the DNS record string for a domain.
     *      Reverts if the domain is frozen.
     */
    function _executeUpdateDns(Proposal storage p) internal {
        Domain storage d = domains[p.domainName];
        require(!d.frozen, "DomainGuard: domain is frozen, unfreeze first");
        d.dnsRecord = p.dnsRecord;
    }

    /**
     * @dev Freeze a domain as an emergency measure.
     *      Only needs 2 approvals, no time-lock — speed is the priority.
     */
    function _executeFreeze(Proposal storage p) internal {
        Domain storage d = domains[p.domainName];
        require(!d.frozen, "DomainGuard: domain is already frozen");
        d.frozen = true;
        emit DomainFrozenStatus(p.domainName, true);
    }

    /**
     * @dev Lift the freeze on a domain.
     *      Needs full 3 approvals + time-lock to prevent hasty unfreezing.
     */
    function _executeUnfreeze(Proposal storage p) internal {
        Domain storage d = domains[p.domainName];
        require(d.frozen, "DomainGuard: domain is not frozen");
        d.frozen = false;
        emit DomainFrozenStatus(p.domainName, false);
    }

    /**
     * @dev Swap one admin address for another.
     *      Updates both the admins[] array and the isAdmin mapping.
     *      The replaced admin immediately loses all privileges.
     */
    function _executeReplaceAdmin(Proposal storage p) internal {
        address oldAdmin = p.targetAddress;
        address newAdmin = p.newAdminAddress;

        // Remove old admin
        isAdmin[oldAdmin] = false;
        for (uint256 i = 0; i < ADMIN_COUNT; i++) {
            if (admins[i] == oldAdmin) {
                admins[i] = newAdmin;
                break;
            }
        }

        // Add new admin
        isAdmin[newAdmin] = true;

        emit AdminReplaced(oldAdmin, newAdmin);
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * @dev Return the number of approvals required for a given action type.
     *      FREEZE needs fewer (emergency), everything else needs THRESHOLD.
     */
    function _requiredApprovals(ActionType actionType)
        private
        pure
        returns (uint256)
    {
        if (actionType == ActionType.FREEZE_DOMAIN) {
            return FREEZE_THRESHOLD; // 2
        }
        return THRESHOLD; // 3
    }
}
