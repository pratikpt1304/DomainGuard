require("dotenv").config();
/** @type import('hardhat/config').HardhatUserConfig */
require("@nomicfoundation/hardhat-toolbox");

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ? process.env.DEPLOYER_PRIVATE_KEY.trim() : "";

// Format accounts array safely without exposing keys or crashing if empty
const accounts = DEPLOYER_PRIVATE_KEY
  ? [DEPLOYER_PRIVATE_KEY.startsWith("0x") ? DEPLOYER_PRIVATE_KEY : `0x${DEPLOYER_PRIVATE_KEY}`]
  : [];

module.exports = {
  solidity: "0.8.24",
  networks: {
    // Local Hardhat network (unchanged)
    hardhat: {},
    // Sepolia Public Testnet (Chain ID 11155111)
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: accounts,
      chainId: 11155111,
    },
  },
};
