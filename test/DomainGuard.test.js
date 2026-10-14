// test/DomainGuard.test.js
//
// Full test suite for DomainGuard — Hardhat 2 + Chai + ethers v6
// Run with:  npx hardhat test
//
// Hardhat's time helpers let us fast-forward the blockchain clock in tests,
// so we don't actually wait 60 real seconds for the time-lock.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");

// ─── Constants matching the contract ─────────────────────────────────────────
const TIME_LOCK = 60; // seconds — must match constructor arg below

// Solidity enum ActionType (order must match the .sol file exactly)
const ActionType = {
  TRANSFER_OWNERSHIP : 0,
  UPDATE_DNS         : 1,
  FREEZE_DOMAIN      : 2,
  UNFREEZE_DOMAIN    : 3,
  REPLACE_ADMIN      : 4,
};

// ─── Deploy helper — called in beforeEach ─────────────────────────────────────
async function deployDomainGuard(signers) {
  const adminAddrs = signers.slice(0, 5).map((s) => s.address);
  const Factory    = await ethers.getContractFactory("DomainGuard");
  const contract   = await Factory.deploy(
    adminAddrs,
    TIME_LOCK,
    "example.com",       // domain pre-registered for testing
    signers[0].address,  // initial owner = admin0
    "A 93.184.216.34"    // initial DNS record
  );
  await contract.waitForDeployment();
  return contract;
}

// ─── Parse proposal ID from a proposeAction receipt ───────────────────────────
async function getProposalId(contract, tx) {
  const receipt = await tx.wait();
  const event   = receipt.logs
    .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ActionProposed");
  return event.args.proposalId;
}

// ─── Propose + have a list of signers approve ─────────────────────────────────
async function proposeAndApprove(contract, proposer, approvers, actionType, opts = {}) {
  const domainName      = opts.domainName      ?? "example.com";
  const targetAddress   = opts.targetAddress   ?? ethers.ZeroAddress;
  const newAdminAddress = opts.newAdminAddress ?? ethers.ZeroAddress;
  const dnsRecord       = opts.dnsRecord       ?? "";

  const tx         = await contract.connect(proposer).proposeAction(
    actionType, domainName, targetAddress, newAdminAddress, dnsRecord
  );
  const proposalId = await getProposalId(contract, tx);

  for (const a of approvers) {
    await contract.connect(a).approve(proposalId);
  }
  return proposalId;
}

// =============================================================================
describe("DomainGuard", function () {

  let contract;
  let admin0, admin1, admin2, admin3, admin4, outsider;

  beforeEach(async function () {
    [admin0, admin1, admin2, admin3, admin4, outsider] = await ethers.getSigners();
    contract = await deployDomainGuard([admin0, admin1, admin2, admin3, admin4]);
  });

  // ===========================================================================
  // SCENARIO 1 — Normal transfer: propose → 3 approve → time-lock → execute
  // ===========================================================================
  describe("Scenario 1: Normal transfer (3-of-5, time-lock)", function () {

    it("changes ownership after 3 approvals + time-lock", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2],
        ActionType.TRANSFER_OWNERSHIP, { targetAddress: outsider.address }
      );
      await time.increase(TIME_LOCK + 1);
      await contract.connect(admin3).execute(proposalId);

      const [owner] = await contract.getDomain("example.com");
      expect(owner).to.equal(outsider.address);
    });

    it("emits ActionExecuted on successful execution", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2],
        ActionType.TRANSFER_OWNERSHIP, { targetAddress: outsider.address }
      );
      await time.increase(TIME_LOCK + 1);
      await expect(contract.connect(admin0).execute(proposalId))
        .to.emit(contract, "ActionExecuted")
        .withArgs(proposalId, ActionType.TRANSFER_OWNERSHIP, "example.com");
    });
  });

  // ===========================================================================
  // SCENARIO 2 — ATTACK: rogue admin tries to execute alone
  // ===========================================================================
  describe("Scenario 2 (ATTACK): Rogue admin with only 1 approval", function () {

    it("REJECTS execution with only 1 approval", async function () {
      const tx = await contract.connect(admin0).proposeAction(
        ActionType.TRANSFER_OWNERSHIP, "example.com",
        outsider.address, ethers.ZeroAddress, ""
      );
      const proposalId = await getProposalId(contract, tx);
      await contract.connect(admin0).approve(proposalId);   // only rogue approves
      await time.increase(TIME_LOCK + 1);

      await expect(contract.connect(admin0).execute(proposalId))
        .to.be.revertedWith("DomainGuard: not enough approvals");

      const [owner] = await contract.getDomain("example.com");
      expect(owner).to.equal(admin0.address); // unchanged
    });
  });

  // ===========================================================================
  // SCENARIO 3 — ATTACK: double-vote by the same admin
  // ===========================================================================
  describe("Scenario 3 (ATTACK): Double-vote by same admin", function () {

    it("REJECTS a second approval from the same admin", async function () {
      const tx = await contract.connect(admin0).proposeAction(
        ActionType.TRANSFER_OWNERSHIP, "example.com",
        outsider.address, ethers.ZeroAddress, ""
      );
      const proposalId = await getProposalId(contract, tx);
      await contract.connect(admin0).approve(proposalId);

      await expect(contract.connect(admin0).approve(proposalId))
        .to.be.revertedWith("DomainGuard: admin already approved this proposal");
    });
  });

  // ===========================================================================
  // SCENARIO 4 — Execute before time-lock expires
  // ===========================================================================
  describe("Scenario 4: Time-lock enforcement", function () {

    it("REJECTS execution before time-lock expires", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2],
        ActionType.TRANSFER_OWNERSHIP, { targetAddress: outsider.address }
      );
      // No time.increase() — time-lock still active
      await expect(contract.connect(admin0).execute(proposalId))
        .to.be.revertedWith("DomainGuard: time-lock period not yet over");
    });

    it("SUCCEEDS just after the time-lock expires", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2],
        ActionType.TRANSFER_OWNERSHIP, { targetAddress: outsider.address }
      );
      await time.increase(TIME_LOCK);  // exactly at boundary
      await expect(contract.connect(admin0).execute(proposalId)).to.not.be.reverted;
    });
  });

  // ===========================================================================
  // SCENARIO 5 — Non-admin cannot propose or approve
  // ===========================================================================
  describe("Scenario 5: Non-admin is rejected", function () {

    it("REJECTS proposeAction from a non-admin", async function () {
      await expect(
        contract.connect(outsider).proposeAction(
          ActionType.TRANSFER_OWNERSHIP, "example.com",
          outsider.address, ethers.ZeroAddress, ""
        )
      ).to.be.revertedWith("DomainGuard: caller is not an admin");
    });

    it("REJECTS approve from a non-admin", async function () {
      const tx = await contract.connect(admin0).proposeAction(
        ActionType.TRANSFER_OWNERSHIP, "example.com",
        outsider.address, ethers.ZeroAddress, ""
      );
      const proposalId = await getProposalId(contract, tx);
      await expect(contract.connect(outsider).approve(proposalId))
        .to.be.revertedWith("DomainGuard: caller is not an admin");
    });
  });

  // ===========================================================================
  // SCENARIO 6 — Emergency freeze (2-of-5, no time-lock) blocks transfers
  // ===========================================================================
  describe("Scenario 6: Emergency freeze", function () {

    it("freezes domain with only 2 approvals and no time-lock", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1], ActionType.FREEZE_DOMAIN
      );
      await contract.connect(admin0).execute(proposalId); // no time.increase needed!
      const [, , frozen] = await contract.getDomain("example.com");
      expect(frozen).to.equal(true);
    });

    it("REJECTS transfer on a frozen domain", async function () {
      const freezeId = await proposeAndApprove(
        contract, admin0, [admin0, admin1], ActionType.FREEZE_DOMAIN
      );
      await contract.connect(admin0).execute(freezeId);

      const transferId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2],
        ActionType.TRANSFER_OWNERSHIP, { targetAddress: outsider.address }
      );
      await time.increase(TIME_LOCK + 1);
      await expect(contract.connect(admin0).execute(transferId))
        .to.be.revertedWith("DomainGuard: domain is frozen, unfreeze first");
    });

    it("emits DomainFrozenStatus(true) on freeze", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1], ActionType.FREEZE_DOMAIN
      );
      await expect(contract.connect(admin0).execute(proposalId))
        .to.emit(contract, "DomainFrozenStatus")
        .withArgs("example.com", true);
    });
  });

  // ===========================================================================
  // SCENARIO 7 — Lost key: REPLACE_ADMIN
  // ===========================================================================
  describe("Scenario 7: Lost key recovery via REPLACE_ADMIN", function () {

    it("replaces a lost admin and revokes the old key", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2],
        ActionType.REPLACE_ADMIN,
        { targetAddress: admin4.address, newAdminAddress: outsider.address }
      );
      await time.increase(TIME_LOCK + 1);
      await contract.connect(admin0).execute(proposalId);

      expect(await contract.isAdmin(admin4.address)).to.equal(false);
      expect(await contract.isAdmin(outsider.address)).to.equal(true);

      // Old key cannot propose
      await expect(
        contract.connect(admin4).proposeAction(
          ActionType.UPDATE_DNS, "example.com",
          ethers.ZeroAddress, ethers.ZeroAddress, "A 1.2.3.4"
        )
      ).to.be.revertedWith("DomainGuard: caller is not an admin");

      // New key can propose
      await expect(
        contract.connect(outsider).proposeAction(
          ActionType.UPDATE_DNS, "example.com",
          ethers.ZeroAddress, ethers.ZeroAddress, "A 1.2.3.4"
        )
      ).to.not.be.reverted;
    });

    it("REJECTS the replaced admin voting on their own replacement", async function () {
      const tx = await contract.connect(admin0).proposeAction(
        ActionType.REPLACE_ADMIN, "example.com",
        admin4.address, outsider.address, ""
      );
      const proposalId = await getProposalId(contract, tx);
      await expect(contract.connect(admin4).approve(proposalId))
        .to.be.revertedWith(
          "DomainGuard: replaced admin cannot approve their own replacement"
        );
    });
  });

  // ===========================================================================
  // SCENARIO 8 — Two honest admins disagree: proposal stays below threshold
  // ===========================================================================
  describe("Scenario 8: Disagreement — not enough approvals", function () {

    it("leaves domain unchanged when only 2 admins approve a transfer", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1],
        ActionType.TRANSFER_OWNERSHIP, { targetAddress: outsider.address }
      );
      await time.increase(TIME_LOCK + 1);
      await expect(contract.connect(admin0).execute(proposalId))
        .to.be.revertedWith("DomainGuard: not enough approvals");

      const [owner] = await contract.getDomain("example.com");
      expect(owner).to.equal(admin0.address);
    });

    it("allows any admin to cancel a stalled proposal", async function () {
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1],
        ActionType.TRANSFER_OWNERSHIP, { targetAddress: outsider.address }
      );
      await expect(contract.connect(admin3).cancel(proposalId))
        .to.emit(contract, "ActionCancelled")
        .withArgs(proposalId, admin3.address);

      await time.increase(TIME_LOCK + 1);
      await expect(contract.connect(admin0).execute(proposalId))
        .to.be.revertedWith("DomainGuard: proposal already cancelled");
    });
  });

  // ===========================================================================
  // EXTRA: DNS update
  // ===========================================================================
  describe("Extra: DNS update (3 approvals + time-lock)", function () {
    it("updates DNS record after 3 approvals and time-lock", async function () {
      const newDns     = "A 1.2.3.4";
      const proposalId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2],
        ActionType.UPDATE_DNS, { dnsRecord: newDns }
      );
      await time.increase(TIME_LOCK + 1);
      await contract.connect(admin0).execute(proposalId);
      const [, dns] = await contract.getDomain("example.com");
      expect(dns).to.equal(newDns);
    });
  });

  // ===========================================================================
  // EXTRA: Unfreeze needs full 3 approvals + time-lock
  // ===========================================================================
  describe("Extra: Unfreeze (3 approvals + time-lock)", function () {

    it("unfreezes domain after 3 approvals and time-lock", async function () {
      const freezeId = await proposeAndApprove(
        contract, admin0, [admin0, admin1], ActionType.FREEZE_DOMAIN
      );
      await contract.connect(admin0).execute(freezeId);

      const unfreezeId = await proposeAndApprove(
        contract, admin0, [admin0, admin1, admin2], ActionType.UNFREEZE_DOMAIN
      );
      await time.increase(TIME_LOCK + 1);
      await contract.connect(admin0).execute(unfreezeId);

      const [, , frozen] = await contract.getDomain("example.com");
      expect(frozen).to.equal(false);
    });

    it("REJECTS unfreeze with only 2 approvals", async function () {
      const freezeId = await proposeAndApprove(
        contract, admin0, [admin0, admin1], ActionType.FREEZE_DOMAIN
      );
      await contract.connect(admin0).execute(freezeId);

      const unfreezeId = await proposeAndApprove(
        contract, admin0, [admin0, admin1], ActionType.UNFREEZE_DOMAIN
      );
      await time.increase(TIME_LOCK + 1);
      await expect(contract.connect(admin0).execute(unfreezeId))
        .to.be.revertedWith("DomainGuard: not enough approvals");
    });
  });

});
