// scripts/deploy-sepolia.js
// Deploys DomainGuard to Sepolia Public Testnet using the 5 addresses in admins.json.
// Checks test ETH balance before deploying. Saves details to deployed-sepolia.json.

const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  console.log("========================================================");
  console.log("DomainGuard — Sepolia Public Testnet Deployment");
  console.log("========================================================\n");

  // 1. Verify network is Sepolia
  const net = await ethers.provider.getNetwork();
  console.log(`Connected Network : ${network.name} (Chain ID: ${net.chainId})`);
  if (net.chainId !== 11155111n) {
    console.error(`\n❌ ERROR: Expected Sepolia testnet (Chain ID 11155111), but connected to Chain ID ${net.chainId}.`);
    console.error("Please run with: npx hardhat run scripts/deploy-sepolia.js --network sepolia\n");
    process.exit(1);
  }

  // 2. Load deployer signer
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    console.error("\n❌ ERROR: No deployer account configured.");
    console.error("Please set DEPLOYER_PRIVATE_KEY in your local .env file.");
    process.exit(1);
  }
  const deployer = signers[0];
  const deployerAddress = await deployer.getAddress();
  console.log(`Deployer Address  : ${deployerAddress}`);

  // 3. Check Sepolia ETH balance
  const balance = await ethers.provider.getBalance(deployerAddress);
  const balanceEth = ethers.formatEther(balance);
  console.log(`Deployer Balance  : ${balanceEth} SepoliaETH`);

  // Require at least 0.003 SepoliaETH for deployment gas
  const minRequired = ethers.parseEther("0.003");
  if (balance < minRequired) {
    console.log("\n❌ INSUFFICIENT SEPOLIA TEST ETH!");
    console.log(`Current Balance   : ${balanceEth} SepoliaETH`);
    console.log(`Estimated Minimum : 0.003 SepoliaETH needed for deployment.`);
    console.log("\nPlease get free Sepolia test ETH for your address from any faucet:");
    console.log(`  - Google Cloud Faucet : https://cloud.google.com/application/web3/faucet/ethereum/sepolia`);
    console.log(`  - Alchemy Faucet      : https://www.alchemy.com/faucets/ethereum-sepolia`);
    console.log(`  - Sepolia PoW Faucet  : https://sepolia-faucet.pk910.de/`);
    console.log(`Target Address: ${deployerAddress}\n`);
    process.exit(1);
  }

  // 4. Load the 5 admin addresses from admins.json
  const adminsPath = path.join(__dirname, "..", "admins.json");
  if (!fs.existsSync(adminsPath)) {
    console.error("\n❌ ERROR: admins.json not found.");
    console.error("Please run: node scripts/generate-admins.js first.");
    process.exit(1);
  }
  const adminsData = JSON.parse(fs.readFileSync(adminsPath, "utf8"));
  if (!Array.isArray(adminsData) || adminsData.length < 5) {
    console.error("\n❌ ERROR: admins.json must contain at least 5 admin addresses.");
    process.exit(1);
  }
  const adminAddresses = adminsData.slice(0, 5).map((a) => a.address);

  console.log("\nRegistered Admins for Contract:");
  adminAddresses.forEach((addr, i) => {
    console.log(`  Admin ${i}: ${addr}`);
  });

  const TIME_LOCK_DELAY = 120; // 120 seconds as requested
  const INITIAL_DOMAIN = "blockhack.com";
  const INITIAL_OWNER = adminAddresses[0];
  const INITIAL_DNS = "A 93.184.216.34";

  console.log(`\nTime-Lock Delay   : ${TIME_LOCK_DELAY} seconds`);
  console.log(`Initial Domain    : ${INITIAL_DOMAIN}`);
  console.log(`Initial Owner     : ${INITIAL_OWNER}`);

  console.log("\nBroadcasting deployment transaction to Sepolia...");
  const Factory = await ethers.getContractFactory("DomainGuard", deployer);
  const contract = await Factory.deploy(
    adminAddresses,
    TIME_LOCK_DELAY,
    INITIAL_DOMAIN,
    INITIAL_OWNER,
    INITIAL_DNS
  );

  const deploymentTx = contract.deploymentTransaction();
  const txHash = deploymentTx ? deploymentTx.hash : "(pending)";
  console.log(`Transaction Hash  : ${txHash}`);
  console.log(`Etherscan Tx Link : https://sepolia.etherscan.io/tx/${txHash}`);
  console.log("Waiting for block confirmation on Sepolia...");

  let contractAddress;
  try {
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  } catch (err) {
    if (txHash && txHash !== "(pending)") {
      console.log("Fetching receipt directly via JSON-RPC provider fallback...");
      const receipt = await ethers.provider.waitForTransaction(txHash, 1);
      contractAddress = receipt.contractAddress;
    } else {
      throw err;
    }
  }

  console.log("\n========================================================");
  console.log("✔ DomainGuard DEPLOYED SUCCESSFULLY ON SEPOLIA!");
  console.log(`Contract Address  : ${contractAddress}`);
  console.log(`Etherscan Contract: https://sepolia.etherscan.io/address/${contractAddress}`);
  console.log("========================================================\n");

  // 5. Save output to deployed-sepolia.json
  const deployedInfo = {
    network: "sepolia",
    chainId: 11155111,
    contractAddress: contractAddress,
    transactionHash: txHash,
    etherscanUrl: `https://sepolia.etherscan.io/address/${contractAddress}`,
    deployedAt: new Date().toISOString(),
    timeLockDelay: TIME_LOCK_DELAY,
    domain: INITIAL_DOMAIN,
    admins: adminAddresses,
    deployer: deployerAddress,
  };

  const outputPath = path.join(__dirname, "..", "deployed-sepolia.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployedInfo, null, 2), "utf8");
  console.log(`Deployment info saved to: deployed-sepolia.json`);
  console.log(`\nNext: Paste ${contractAddress} into frontend-sepolia.html!`);
}

main().catch((err) => {
  console.error("\n❌ Deployment failed:", err);
  process.exitCode = 1;
});
