// scripts/demo.js — CommonJS version for Hardhat 2
// Run with: npx hardhat run scripts/demo.js

const { ethers } = require("hardhat");

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

function section(title) {
  console.log("\n" + BOLD + CYAN + "═".repeat(60) + RESET);
  console.log(BOLD + CYAN + "  " + title + RESET);
  console.log(BOLD + CYAN + "═".repeat(60) + RESET);
}
function ok(msg)   { console.log(GREEN  + "  ✔  " + msg + RESET); }
function fail(msg) { console.log(RED    + "  ✘  " + msg + RESET); }
function info(msg) { console.log(YELLOW + "  ►  " + msg + RESET); }
function divider() { console.log(CYAN   + "  " + "─".repeat(56) + RESET); }

function getRevertReason(e) {
  if (e.reason) return e.reason;
  if (e.revert && e.revert.args && e.revert.args[0]) return e.revert.args[0];
  const match = (e.message || "").match(/reverted with reason string ['"]([^'"]+)['"]/);
  if (match) return match[1];
  if (e.shortMessage) return e.shortMessage;
  return e.message ? e.message.split("\n")[0] : "Reverted";
}

const ActionType = {
  TRANSFER_OWNERSHIP : 0,
  UPDATE_DNS         : 1,
  FREEZE_DOMAIN      : 2,
  UNFREEZE_DOMAIN    : 3,
  REPLACE_ADMIN      : 4,
};

async function getProposalId(contract, tx) {
  const receipt = await tx.wait();
  const event   = receipt.logs
    .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ActionProposed");
  return event.args.proposalId;
}

async function fastForward(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

async function printDomain(contract, name) {
  const [owner, dns, frozen] = await contract.getDomain(name);
  console.log(`       Domain  : ${name}`);
  console.log(`       Owner   : ${owner}`);
  console.log(`       DNS     : ${dns}`);
  console.log(`       Frozen  : ${frozen}`);
}

async function main() {
  console.log("\n" + BOLD + "  DomainGuard — Live Demo" + RESET);
  console.log("  Hackathon: BLOCKHACK | Problem: PS-08 The Rogue Admin\n");

  const signers = await ethers.getSigners();
  const [admin0, admin1, admin2, admin3, admin4, attacker, , newKeySigner] = signers;

  info(`Admin 0 (Alice)  : ${admin0.address}`);
  info(`Admin 1 (Bob)    : ${admin1.address}`);
  info(`Admin 2 (Carol)  : ${admin2.address}`);
  info(`Admin 3 (Dave)   : ${admin3.address}`);
  info(`Admin 4 (Eve)    : ${admin4.address}`);
  info(`Attacker         : ${attacker.address}`);

  // Deploy
  section("SETUP: Deploying DomainGuard");
  const Factory  = await ethers.getContractFactory("DomainGuard");
  const contract = await Factory.deploy(
    [admin0.address, admin1.address, admin2.address, admin3.address, admin4.address],
    60, "blockhack.com", admin0.address, "A 93.184.216.34"
  );
  await contract.waitForDeployment();
  ok(`Contract deployed at: ${await contract.getAddress()}`);
  ok("5 admins: Alice, Bob, Carol, Dave, Eve | Time-lock: 60s");
  divider();
  info("Initial domain state:");
  await printDomain(contract, "blockhack.com");

  // ── ACT 1: Normal transfer ─────────────────────────────────────────────────
  section("ACT 1: Normal Transfer — 3 admins approve, time-lock, execute");

  const tx1        = await contract.connect(admin0).proposeAction(
    ActionType.TRANSFER_OWNERSHIP, "blockhack.com",
    attacker.address, ethers.ZeroAddress, ""
  );
  const proposalId1 = await getProposalId(contract, tx1);
  ok(`Proposal #${proposalId1} created by Alice`);

  await contract.connect(admin0).approve(proposalId1); ok("Alice approved  (1/3)");
  await contract.connect(admin1).approve(proposalId1); ok("Bob approved    (2/3)");
  await contract.connect(admin2).approve(proposalId1); ok("Carol approved  (3/3) ← time-lock starts!");

  info("Fast-forwarding 61 seconds...");
  await fastForward(61);

  await contract.connect(admin3).execute(proposalId1);
  ok("Transfer EXECUTED by Dave!");
  info("Domain state after transfer:");
  await printDomain(contract, "blockhack.com");

  // Transfer back for next act
  const txBack = await contract.connect(admin0).proposeAction(
    ActionType.TRANSFER_OWNERSHIP, "blockhack.com", admin0.address, ethers.ZeroAddress, ""
  );
  const pidBack = await getProposalId(contract, txBack);
  await contract.connect(admin0).approve(pidBack);
  await contract.connect(admin1).approve(pidBack);
  await contract.connect(admin2).approve(pidBack);
  await fastForward(61);
  await contract.connect(admin0).execute(pidBack);
  ok("Domain transferred back to Alice for next act.");

  // ── ACT 2: Rogue admin attack ──────────────────────────────────────────────
  section("ACT 2: ROGUE ADMIN ATTACK — Bob tries to act alone");

  const tx2        = await contract.connect(admin1).proposeAction(
    ActionType.TRANSFER_OWNERSHIP, "blockhack.com",
    admin1.address, ethers.ZeroAddress, ""
  );
  const proposalId2 = await getProposalId(contract, tx2);
  await contract.connect(admin1).approve(proposalId2);
  ok(`Rogue proposal #${proposalId2} created, Bob self-approved (1/3)`);
  await fastForward(61);

  console.log("\n  " + BOLD + RED + "ATTACK ATTEMPT: Bob executes alone →" + RESET);
  try {
    await contract.connect(admin1).execute(proposalId2);
    fail("BREACH — should never print!");
  } catch (e) {
    ok("REJECTED! \"" + getRevertReason(e) + "\"");
  }

  console.log("\n  " + BOLD + RED + "ATTACK ATTEMPT: Bob votes twice →" + RESET);
  try {
    await contract.connect(admin1).approve(proposalId2);
    fail("BREACH — double vote allowed!");
  } catch (e) {
    ok("REJECTED! \"" + getRevertReason(e) + "\"");
  }

  console.log("\n  " + BOLD + RED + "ATTACK ATTEMPT: Outsider proposes →" + RESET);
  try {
    await contract.connect(attacker).proposeAction(
      ActionType.TRANSFER_OWNERSHIP, "blockhack.com",
      attacker.address, ethers.ZeroAddress, ""
    );
    fail("BREACH — outsider got in!");
  } catch (e) {
    ok("REJECTED! \"" + getRevertReason(e) + "\"");
  }

  // ── ACT 3A: Emergency freeze ───────────────────────────────────────────────
  section("ACT 3A: EMERGENCY FREEZE — 2 approvals, no time-lock");

  const tx3        = await contract.connect(admin0).proposeAction(
    ActionType.FREEZE_DOMAIN, "blockhack.com", ethers.ZeroAddress, ethers.ZeroAddress, ""
  );
  const proposalId3 = await getProposalId(contract, tx3);
  await contract.connect(admin0).approve(proposalId3);
  await contract.connect(admin1).approve(proposalId3);
  await contract.connect(admin0).execute(proposalId3); // no time-lock!
  ok("Domain FROZEN instantly!");
  await printDomain(contract, "blockhack.com");

  console.log("\n  " + BOLD + RED + "ATTACK ATTEMPT: Transfer frozen domain →" + RESET);
  const txFrozenTransfer = await contract.connect(admin0).proposeAction(
    ActionType.TRANSFER_OWNERSHIP, "blockhack.com", attacker.address, ethers.ZeroAddress, ""
  );
  const pidFrozenTransfer = await getProposalId(contract, txFrozenTransfer);
  await contract.connect(admin0).approve(pidFrozenTransfer);
  await contract.connect(admin1).approve(pidFrozenTransfer);
  await contract.connect(admin2).approve(pidFrozenTransfer);
  await fastForward(61);
  try {
    await contract.connect(admin0).execute(pidFrozenTransfer);
    fail("BREACH — frozen domain was transferred!");
  } catch (e) {
    ok("REJECTED! \"" + getRevertReason(e) + "\"");
  }

  // ── ACT 3B: Lost key recovery ──────────────────────────────────────────────
  section("ACT 3B: LOST KEY RECOVERY — replace Eve (admin4)");

  const tx4 = await contract.connect(admin0).proposeAction(
    ActionType.REPLACE_ADMIN, "blockhack.com",
    admin4.address, newKeySigner.address, ""
  );
  const proposalId4 = await getProposalId(contract, tx4);
  await contract.connect(admin0).approve(proposalId4); ok("Alice approved (1/3)");
  await contract.connect(admin1).approve(proposalId4); ok("Bob approved   (2/3)");
  await contract.connect(admin2).approve(proposalId4); ok("Carol approved (3/3)");

  console.log("\n  " + BOLD + RED + "GUARD CHECK: Eve votes on her own replacement →" + RESET);
  try {
    await contract.connect(admin4).approve(proposalId4);
    fail("BREACH — Eve could self-vote!");
  } catch (e) {
    ok("REJECTED! \"" + getRevertReason(e) + "\"");
  }

  await fastForward(61);
  await contract.connect(admin0).execute(proposalId4);
  ok(`Eve's old key REVOKED: ${admin4.address}`);
  ok(`New key ACTIVATED: ${newKeySigner.address}`);

  console.log("\n  " + BOLD + RED + "FINAL CHECK: Eve's old key tries to act →" + RESET);
  try {
    await contract.connect(admin4).proposeAction(
      ActionType.UPDATE_DNS, "blockhack.com", ethers.ZeroAddress, ethers.ZeroAddress, "A 9.9.9.9"
    );
    fail("BREACH — old key still works!");
  } catch (e) {
    ok("REJECTED! \"" + getRevertReason(e) + "\"");
  }

  const txNewKey = await contract.connect(newKeySigner).proposeAction(
    ActionType.UPDATE_DNS, "blockhack.com", ethers.ZeroAddress, ethers.ZeroAddress, "A 1.1.1.1"
  );
  const pidNewKey = await getProposalId(contract, txNewKey);
  ok(`New admin created proposal #${pidNewKey} successfully!`);

  // Summary
  section("DEMO COMPLETE — Summary");
  ok("Normal 3-of-5 transfer with time-lock        ✔");
  ok("Rogue solo execution blocked                 ✔");
  ok("Double-vote blocked                          ✔");
  ok("Non-admin blocked                            ✔");
  ok("Emergency freeze (2-of-5, no time-lock)      ✔");
  ok("Frozen domain transfer blocked               ✔");
  ok("Lost key replaced (3-of-4 other admins)      ✔");
  ok("Self-replacement vote blocked                ✔");
  console.log("\n" + BOLD + GREEN + "  DomainGuard is secure. Demo complete!" + RESET + "\n");
}

main().catch((err) => {
  console.error(RED + "\nDemo error:" + RESET, err);
  process.exitCode = 1;
});
