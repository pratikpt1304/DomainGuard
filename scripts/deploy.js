// scripts/deploy.js
// Deploys DomainGuard on local Hardhat node for frontend use
const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  const adminAddrs = signers.slice(0, 5).map((s) => s.address);

  console.log("Deploying DomainGuard with admins:");
  adminAddrs.forEach((addr, i) => {
    console.log(`  Admin ${i}: ${addr}`);
  });

  const Factory = await ethers.getContractFactory("DomainGuard");
  const contract = await Factory.deploy(
    adminAddrs,
    60, // 60 seconds timeLockDelay for demo
    "blockhack.com",
    adminAddrs[0], // initial owner = Alice
    "A 93.184.216.34" // initial DNS record
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n========================================================");
  console.log("DomainGuard deployed successfully!");
  console.log(`Contract Address: ${address}`);
  console.log("========================================================");
  console.log("Paste this address into your frontend.html input box!");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
