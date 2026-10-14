# 🏆 BLOCKHACK 2026 — Official Presentation & Pitch Guide

> **Problem Statement:** PS-08 — The Rogue Admin (Multi-Party Control for Critical Domain Operations)  
> **Team:** 4 Members | Sanjivani University  
> **Target Rounds:** Round 1 (Idea & PPT) & Round 2 (Final Prototype Demo)

---

## 🎯 60-Second Elevator Pitch

> *"Good afternoon, judges. We are presenting **DomainGuard**, solving **Problem Statement 08: The Rogue Admin**.*
>
> *In traditional domain registrars, if an employee with legitimate credentials turns malicious or has their credentials leaked, they can unilaterally transfer critical domains like `google.com` or banking infrastructure. Traditional RBAC cannot distinguish between legitimate authority and the malicious abuse of legitimate authority.*
>
> *DomainGuard eliminates the single point of failure by replacing the centralized database with an immutable multi-sig smart contract. In our system, **no single person can ever move or modify a domain alone**. All operations require a 3-of-5 admin consensus with a time-lock delay, an emergency 2-of-5 freeze mechanism, and a decentralized key-recovery protocol that safely revokes compromised credentials."*

---

## 📋 Slide-by-Slide PPT Outline (For Round 1 Evaluation)

### Slide 1: Title & Team
- **Title:** DomainGuard: Autonomous Multi-Party Authorization for Critical Domain Registries
- **Problem Statement:** PS-08 — The Rogue Admin
- **Tagline:** *"Decentralizing Administrative Authority at the Protocol Level"*

### Slide 2: The Problem: Insider Threats in Domain Registrars
- **The Core Issue:** Legitimate admins have full write access to registrar databases.
- **Why Web2 Fails:**
  - Traditional Role-Based Access Control (RBAC) grants total power once logged in.
  - Centralized audit logs only alert after the domain is already transferred.
  - A database administrator (DBA) can bypass APIs or edit logs directly.

### Slide 3: The Architecture & Innovation
- **Smart Contract as the Registry:** Domain ownership and DNS records are stored on-chain.
- **M-of-N Multi-Party Control:** 3-of-5 approvals required for transfers and DNS updates.
- **Asymmetric Security Thresholds:**
  - *Standard Actions:* 3 approvals + mandatory time-lock window.
  - *Emergency Freeze:* 2 approvals + 0-second delay for instant incident response.
- **No Backdoors:** No `owner`, no `onlyOwner`, no upgrade proxy.

### Slide 4: System Architecture Diagram
*(Use the Mermaid diagram from README.md)*
- 5 Admin Key Holders $\rightarrow$ Proposal Queue $\rightarrow$ Time-Lock Delay $\rightarrow$ Domain Registry Store $\rightarrow$ ethers.js UI.

### Slide 5: Adversarial Scenario Responses (Hackathon Proof)
- **Hour 4 Attack Event:** Rogue admin tries solo transfer $\rightarrow$ Smart contract autonomously reverts (`"not enough approvals"`). Zero human intervention needed.
- **Judging Event:** Key lost/compromised $\rightarrow$ 3 remaining admins execute `REPLACE_ADMIN`. Compromised key is revoked immediately.

### Slide 6: Technology Stack & Feasibility
- **EVM Smart Contracts:** Solidity 0.8.24
- **Testing & Verification:** Hardhat, Mocha, Chai (18 automated tests passing)
- **Client & Integration:** Ethers.js v6, JSON-RPC, HTML5 Dashboard

---

## 🧑‍⚖️ The 6 Mandatory Architecture Defense Questions (Page 2)

Memorize or read these exact responses when the judges ask:

### 1. Why does this system need blockchain?
**Answer:**  
In Web2, access control relies on a database server. Anyone with root or DBA access can run `UPDATE domains SET owner = attacker` or alter the audit logs. Blockchain is essential because smart contract execution is deterministic and immutable: **no human superuser exists** who can bypass the 3-of-5 rule.

### 2. What happens if we replace your blockchain with PostgreSQL + digital signatures?
**Answer:**  
PostgreSQL cannot solve Byzantine consensus. The server administrator can censor honest signatures, reorder transactions, drop approval messages, or restore a database snapshot from yesterday to resurrect revoked keys. Blockchain guarantees Byzantine Fault Tolerance, censorship resistance, and unalterable state history.

### 3. Who are your trust participants?
**Answer:**  
The 5 independent administrators (e.g. Security, Legal, Operations, Infrastructure, External Auditor). The system only assumes that fewer than 3 admins are compromised simultaneously.

### 4. What happens when one participant becomes malicious?
**Answer:**  
A single rogue admin can propose an action and self-approve, but execution requires 3 approvals. The contract autonomously reverts on `execute()`. Honest admins see the event on-chain, freeze the domain with 2 approvals, and replace the rogue key with 3 approvals.

### 5. What happens when two honest participants disagree?
**Answer:**  
The proposal stalls at 2 approvals. Because the threshold is 3, the contract prioritizes **safety over liveness**—no changes occur until consensus is reached. Stalled proposals can be cancelled by any admin.

### 6. What information must actually be on-chain, and why?
**Answer:**  
Only state requiring trust invariance: domain ownership, DNS records, frozen status, admin addresses, and proposal approval counts. Off-chain UI and resolvers read this state.

---

## 💻 Round 2 Prototype Demo Script (2 Minutes Live)

1. **Show the Web UI:** Point to [`frontend.html`](file:///c:/Users/thora/OneDrive/DTIL/Documents/My%20Work/Hackathons/Blockchain%20Hackathon%202k26/frontend.html). Show `blockhack.com` owned by Alice.
2. **Execute the Rogue Admin Attack:**
   - Switch active account to **Bob**.
   - Propose transferring `blockhack.com` to Bob's personal address.
   - Bob self-approves (Approval count: `1/3`).
   - Click **Execute** $\rightarrow$ Show the error toast/log: `"DomainGuard: not enough approvals"`.
3. **Execute Emergency Freeze:**
   - Switch to Alice, click **Emergency Freeze**.
   - Switch to Carol, approve freeze.
   - Show status changing to `🔒 YES — locked`.
4. **Show Automated Test Suite:**
   - Run `npx hardhat test` in terminal. Show judges all 18 test cases passing in green.
