# 🎤 EXPLAIN.md — How DomainGuard Works (Judge Presentation Guide)

> **For Judges & Team Members:**  
> This document explains the codebase in simple, plain English so any team member can confidently explain every single function and design choice to hackathon judges.

---

## 🎯 The Big Idea in 30 Seconds

> *"Traditional access control says: 'Does this person have an admin badge?' If yes, they can do anything.*  
> *DomainGuard says: 'No matter who you are, **no single person** can move or touch this domain alone. You need 3 out of 5 admins to sign on-chain, and even then, there is a delay so the others can inspect it before it takes effect.'*  
> *Most importantly: the rules are enforced by immutable smart contract logic, not by an admin with a database password."*

---

## 🔑 Key Components & Variables

1. **`admins` array & `isAdmin` mapping:**
   - Stores the 5 authorized Ethereum addresses.
   - Initialized at deployment time in the `constructor`.
   - Cannot be modified except through a `REPLACE_ADMIN` multi-sig vote.

2. **`domains` mapping (`string => Domain`):**
   - The contract is the **authoritative registry**. It stores:
     - `owner`: Which Ethereum address owns the domain.
     - `dnsRecord`: The IP/nameserver string (e.g. `A 93.184.216.34`).
     - `frozen`: A boolean lock flag. If `true`, NO transfer or DNS changes can occur.
     - `exists`: A safety check so nobody operates on uninitialized domains.

3. **`THRESHOLD = 3` vs `FREEZE_THRESHOLD = 2`:**
   - Routine & critical operations (transfer, DNS update, unfreeze, admin replacement) require **3 approvals** (majority).
   - Emergency freeze requires only **2 approvals** so honest admins can act immediately if an attack is underway.

4. **`timeLockDelay` (e.g. 60 seconds):**
   - The time that must elapse between reaching the 3rd approval and calling `execute()`.
   - Prevents stealth attacks where multiple compromised accounts try to rush a transaction through in a single second.

---

## ⚙️ Function-by-Function Walkthrough

### 1. `constructor(...)`
- **What it does:** Sets up the 5 initial admins, validates that no admin is `address(0)` or duplicated, stores the time-lock delay, and seeds an initial domain (`blockhack.com`).
- **Why this matters for judges:** There is **NO `owner` set**. Contracts that use `Ownable` allow a creator backdoor. DomainGuard deliberately avoids `Ownable`.

### 2. `proposeAction(...)`
- **What it does:** Any admin can propose one of five operations:
  - `TRANSFER_OWNERSHIP`
  - `UPDATE_DNS`
  - `FREEZE_DOMAIN`
  - `UNFREEZE_DOMAIN`
  - `REPLACE_ADMIN`
- **Design detail:** The proposer does **NOT** automatically approve the proposal. They must call `approve()` explicitly. This guarantees identical verification paths and prevents shortcut exploits.

### 3. `approve(proposalId)`
- **What it does:** Records an admin's vote for proposal `proposalId`.
- **Enforced Rules:**
  1. `onlyAdmin`: Non-admins are rejected immediately.
  2. `!p.hasApproved[msg.sender]`: An admin can only approve once (no double-voting).
  3. `!p.executed` & `!p.cancelled`: Votes on closed proposals are rejected.
  4. **The Replacement Rule:** If the proposal is `REPLACE_ADMIN`, the admin being replaced **CANNOT** vote to save themselves or influence the outcome.
- **Time-Lock Trigger:** When `approvalCount` reaches the required threshold, `thresholdReachedAt` is stamped with `block.timestamp`.

### 4. `execute(proposalId)`
- **What it does:** Applies the proposed changes to the contract state.
- **Enforced Rules:**
  1. Must have reached the required approvals (>= 3 for regular, >= 2 for freeze).
  2. If not a freeze, it verifies: `block.timestamp >= thresholdReachedAt + timeLockDelay`.
  3. Reverts if the domain is currently `frozen` (for transfers and DNS updates).
  4. Marks `p.executed = true` to prevent replay attacks.
- **Who can call it?** Any admin! Not just the original proposer. This prevents a malicious proposer from holding an approved action hostage by refusing to execute.

### 5. `cancel(proposalId)`
- **What it does:** Marks a pending proposal as cancelled so it can never be executed.
- **Why it matters:** If honest admins notice a suspicious proposal or if an agreement cannot be reached, any admin can cancel it to keep the proposal queue clean.

### 6. Emergency Actions: `_executeFreeze` vs `_executeUnfreeze`
- **Freeze:** Needs only **2 approvals** and **0 seconds delay**. When frozen, `domains[name].frozen = true`. Transfers and DNS updates immediately revert.
- **Unfreeze:** Needs the full **3 approvals** and the **time-lock delay**. This asymmetry prevents an attacker from quickly unfreezing a domain they are trying to steal.

### 7. Key Recovery: `_executeReplaceAdmin`
- **What it does:** Removes `oldAdmin` from the `admins` array and sets `isAdmin[oldAdmin] = false`. Adds `newAdmin` and sets `isAdmin[newAdmin] = true`.
- **Effect:** The old private key loses all privileges immediately upon execution. The new key is immediately authorized.

---

## 💡 Quick Tips for the Live Demo

1. **Start with the problem:**  
   *"In DNS and Web2 registrar breaches, a single compromised employee account can steal a billion-dollar domain. We fixed that."*
2. **Show the failed attack:**  
   Show the console output where Bob (rogue admin) submits a transfer, approves it himself, and tries to execute. The contract reverts: `"not enough approvals"`.
3. **Show the emergency freeze:**  
   Show how 2 admins freeze the domain in seconds, neutralizing the attacker before any damage is done.
4. **Show lost key recovery:**  
   Show replacing Eve's lost key without any central administrator.
