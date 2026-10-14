# 🛡️ DEFENSE.md — Critical Questions & Answers for Judges

> **Hackathon Defense Document (PS-08: The Rogue Admin)**  
> Anticipated judge questions, tough architectural challenges, and rigorous answers demonstrating that blockchain is essential, not decorative.

---

### Q1: "Why use a blockchain at all? Why not just an SQL database with an audit log?"

**The Judge's Challenge:**  
*"You could just write a normal backend with Node.js and a database, and insert a row in an `audit_log` table whenever someone transfers a domain."*

**Our Defense:**  
1. **Audit Logs are Post-Mortem, Not Preventative:**  
   An audit log records a crime *after* it happens. By the time an alert fires, the rogue admin has already moved the domain, DNS records have propagated globally, and critical services are offline or compromised.
2. **The Root/DBA Vulnerability:**  
   Any centralized database has superusers (e.g. `postgres`, `root`, RDS admin, cloud infrastructure admins). A rogue engineer with database access or cloud console credentials can:
   - Run `UPDATE domains SET owner = 'rogue' WHERE id = 1;`
   - Delete or alter the audit log records: `DELETE FROM audit_logs WHERE user = 'rogue';`
   - Modify the backend code or bypass the API server entirely.
3. **Smart Contracts Guarantee Execution Invariance:**  
   On Ethereum/EVM, the state of the domain is stored inside the smart contract bytecode. **There is no underlying SQL prompt or shell.** No one—not even the developer who wrote the contract—can execute an update without satisfying the cryptographic multi-sig conditions in EVM bytecode.

---

### Q2: "What if we replaced the blockchain with PostgreSQL + Cryptographic Signatures?"

**The Judge's Challenge:**  
*"What if our database requires 3 valid cryptographic signatures from admins before applying an UPDATE query? Isn't that off-chain multi-sig without the blockchain overhead?"*

**Our Defense:**  
While cryptographic signatures protect payload authenticity, **PostgreSQL cannot solve the Byzantine Consensus problem**:
1. **State Equivocation / Split-Brain:**  
   The database server is still operated by a central party. The database administrator can selectively hide approvals, reorder transactions, or present different states to different admins (equivocation).
2. **Censorship & Denial of Service:**  
   A rogue DBA can accept signatures from honest admins and simply drop them into `/dev/null`, refusing to commit the transaction, while quietly approving their own.
3. **Replay & State Rollback:**  
   A rogue infrastructure admin can restore a snapshot of PostgreSQL from yesterday (before a freeze or before an admin key revocation) and re-execute expired or cancelled operations.
4. **Why Blockchain is Required:**  
   The blockchain provides:
   - **Decentralized state ordering (BFT consensus):** No single entity can reorder or roll back state.
   - **Guaranteed execution:** Once 3 signatures are mined on-chain, execution is deterministic and censorship-resistant.
   - **Self-contained state:** Domain ownership and access logic live in the exact same immutable execution environment.

---

### Q3: "Who are the trust participants in this system?"

**Our Defense:**  
1. **The 5 Admins (Key Holders):**  
   - Independent participants who may belong to different legal entities, departments, or security teams (e.g., Security, Legal, Operations, Infrastructure, Independent Auditor).
   - They do not need to trust each other individually; they only need to trust the **quorum assumption** (that fewer than 3 admins are compromised simultaneously).
2. **The Domain Owner / Registrant:**  
   - Can monitor the public blockchain transparently. Because all proposals are broadcast as on-chain events, domain owners have immediate visibility during the time-lock window if an unauthorized transfer is proposed.
3. **The Public / Resolvers:**  
   - Can verify domain ownership and DNS authenticity directly from the smart contract without trusting the registrar's internal servers.

---

### Q4: "What if one participant is malicious?"

**Our Defense:**  
- **Scenario:** Admin Bob becomes rogue and tries to steal `blockhack.com`.
- **System Defense:**
  1. Bob calls `proposeAction(...)` proposing to transfer the domain to his own wallet.
  2. Bob calls `approve(...)`. His approval count is **1/3**.
  3. Bob calls `execute(...)`. The transaction **reverts with `"not enough approvals"`**.
  4. Bob tries to approve again. The transaction **reverts with `"admin already approved this proposal"`**.
  5. The remaining honest admins see the rogue proposal event on-chain.
  6. Any 2 honest admins call `FREEZE_DOMAIN` to instantly freeze the domain with **no time-lock delay**.
  7. 3 honest admins call `REPLACE_ADMIN`, replacing Bob's compromised key with a fresh key. Bob's key is stripped of all privileges on-chain forever.

---

### Q5: "What if two honest participants disagree?"

**Our Defense:**  
- **Scenario:** 2 admins want to update DNS records to Server A, while 2 other admins want Server B, and the 5th admin is offline or neutral.
- **System Defense:**
  1. Neither proposal reaches the threshold of **3 approvals**.
  2. Because the contract requires `>= 3` approvals, **the domain remains safely in its current state**.
  3. The contract defaults to **safety over liveness**: in a dispute, no unauthorized change occurs.
  4. Any admin can call `cancel(proposalId)` on the stalled proposal once discussions conclude.

---

### Q6: "What MUST be on-chain and what can remain off-chain?"

**Our Defense:**

| Component | Location | Why? |
|---|:---:|---|
| **Domain Ownership & DNS Records** | **On-Chain** | If state is off-chain, the database admin can tamper with it directly. Putting it on-chain makes the smart contract the ultimate source of truth. |
| **Admin Membership & Permissions** | **On-Chain** | Eliminates central authority or superuser override. Membership can only change via on-chain consensus. |
| **Proposal & Approval Logic** | **On-Chain** | Enforces the 3-of-5 threshold, emergency 2-of-5 freeze, and prevents double-voting. |
| **Time-Lock Window** | **On-Chain** | Uses `block.timestamp` to guarantee an unalterable review window. An off-chain timer can be artificially skipped by server clocks. |
| **Web UI & DNS Resolvers** | **Off-Chain** | Frontend web applications (`frontend.html`) and external DNS resolvers read the on-chain state to serve end-user traffic. |
