// scripts/generate-admins.js
// Generates 5 throwaway test admin wallets for Sepolia testnet.
// SECURITY: NEVER prints private keys to console.
// Saves addresses to admins.json (safe to view/commit).
// Saves private keys to admins.private.json (STRICTLY GITIGNORED).

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function main() {
  console.log("Generating 5 fresh throwaway admin wallets for Sepolia testnet...\n");

  const adminsPublic = [];
  const adminsPrivate = [];

  const roles = [
    "Admin 0 (Alice - Primary Deployer)",
    "Admin 1 (Bob - Test Rogue Admin)",
    "Admin 2 (Carol - Honest Approver)",
    "Admin 3 (Dave - Honest Approver)",
    "Admin 4 (Eve - Lost Key / Replaced)",
  ];

  for (let i = 0; i < 5; i++) {
    const wallet = ethers.Wallet.createRandom();
    
    adminsPublic.push({
      index: i,
      role: roles[i],
      address: wallet.address,
    });

    adminsPrivate.push({
      index: i,
      role: roles[i],
      address: wallet.address,
      privateKey: wallet.privateKey, // Stored ONLY in local gitignored file
    });

    // Safe output: Only prints addresses, NEVER private keys
    console.log(`[${i}] ${roles[i]}: ${wallet.address}`);
  }

  // 1. Write public addresses (safe)
  const publicPath = path.join(__dirname, "..", "admins.json");
  fs.writeFileSync(publicPath, JSON.stringify(adminsPublic, null, 2), "utf8");
  console.log(`\n✔ Saved public addresses to: admins.json (safe to view/commit)`);

  // 2. Write private keys to gitignored file (sensitive)
  const privatePath = path.join(__dirname, "..", "admins.private.json");
  fs.writeFileSync(privatePath, JSON.stringify(adminsPrivate, null, 2), "utf8");
  console.log(`✔ Saved private keys to: admins.private.json (NEVER commit this file)`);

  console.log("\n========================================================");
  console.log("NEXT STEPS FOR METAMASK IMPORT & DEPLOYMENT:");
  console.log("1. Account 0 (Alice) is designated as your DEPLOYER.");
  console.log("2. Open your local 'admins.private.json' file in your editor.");
  console.log("3. Copy the 'privateKey' for Admin 0 and paste it into '.env':");
  console.log("   DEPLOYER_PRIVATE_KEY=<privateKey_of_Admin_0>");
  console.log("4. Import the private keys into MetaMask:");
  console.log("   In MetaMask -> Click Account Selector -> Add Account -> Import Account");
  console.log("   -> Paste private key for each admin you want to test with.");
  console.log("5. Fund Admin 0 with free Sepolia test ETH using a faucet.");
  console.log("========================================================\n");
}

main();
