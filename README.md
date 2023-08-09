# Mint Club V2
The inherited token creator employs a bonding curve to generate new tokens using base tokens as collateral

## Contract addresses 📜
### Ethereum Sepolia Testnet
- MCV2_Token: [0x4bF67e5C9baD43DD89dbe8fCAD3c213C868fe881](https://sepolia.etherscan.io/address/0x4bF67e5C9baD43DD89dbe8fCAD3c213C868fe881#code)
- MCV2_Bond: [0x905F3AE86108c6A3b1a345dACEaef6c4749Ec66a](https://sepolia.etherscan.io/address/0x905F3AE86108c6A3b1a345dACEaef6c4749Ec66a#code)

## Design Choices 📐
Unlike Mint Club V1's bonding curve (`y = x` -> `total supply = token price`), the V2 contract uses a custom increasing price step array for the following reasons:
1. Utilizing `y = ax^b` bonding curves is challenging to test because we have to use approximation to calculate the power function of `(_baseN / _baseD) ^ (_expN / _expD)` ([Reference: Banchor's Bonding Curve implementation](https://github.com/relevant-community/bonding-curve/blob/master/contracts/Power.sol))
2. Employing a single bonding curve is hard to customize. Supporting various types of curve functions (e.g., Sigmoid, Logarithm, etc) might be too difficult to implement in Solidity, or even impossible in many cases
3. Therefore, we decided to use an array of price steps (called `BondStep[] { rangeTo, price }`), that is simple to calculate and fully customizable.

### An example of a price step array:
![image](https://github.com/Steemhunt/mint.club-v2-contract/assets/1332279/d61607a2-39cc-433a-8cd2-3bbb627ab2aa)

Parameters:
- maxSupply: 10,000
- stepRanges: [ 1000, 1600, 2200, 2800, ..., 10000 ]
- stepPrices: [ 2, 2.1, 2.3, 2.7, ..., 10 ]

## Run Tests 🧪
```bash
npx hardhat test
```

### Coverage ☂️
```m
-------------------------|----------|----------|----------|----------|----------------|
File                     |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
-------------------------|----------|----------|----------|----------|----------------|
 contracts/              |    89.03 |    83.06 |    78.38 |    88.37 |                |
  Locker.sol             |        0 |        0 |        0 |        0 |... 44,45,46,49 |
  MCV2_Bond.sol          |    97.83 |    94.12 |    85.71 |    97.48 |    148,272,276 |
  MCV2_FeeCollector.sol  |       25 |    16.67 |    57.14 |    42.86 |... 36,38,48,56 |
  MCV2_Token.sol         |      100 |       50 |      100 |      100 |                |
  MerkleDistributor.sol  |    97.62 |      100 |       90 |    98.31 |            119 |
 contracts/lib/          |    72.92 |    59.09 |    77.78 |    76.67 |                |
  ERC20Initializable.sol |    72.92 |    59.09 |    77.78 |    76.67 |... 171,172,175 |
 contracts/mock/         |      100 |      100 |      100 |      100 |                |
  TestToken.sol          |      100 |      100 |      100 |      100 |                |
-------------------------|----------|----------|----------|----------|----------------|
All files                |    85.29 |    79.45 |    78.57 |    85.87 |                |
-------------------------|----------|----------|----------|----------|----------------|
```

## Deploy 🚀
```bash
npx hardhat compile && HARDHAT_NETWORK=ethsepolia node scripts/deploy.js
```

## Gas Consumption ⛽️
```m
·--------------------------------------------|---------------------------|---------------|-----------------------------·
|            Solc version: 0.8.20            ·  Optimizer enabled: true  ·  Runs: 50000  ·  Block limit: 30000000 gas  │
·············································|···························|···············|······························
|  Methods                                   ·                15 gwei/gas                ·       1859.34 usd/eth       │
······················|······················|·············|·············|···············|···············|··············
|  Contract           ·  Method              ·  Min        ·  Max        ·  Avg          ·  # calls      ·  usd (avg)  │
······················|······················|·············|·············|···············|···············|··············
|  ERC20              ·  approve             ·      48946  ·      49222  ·        49190  ·           17  ·       1.37  │
······················|······················|·············|·············|···············|···············|··············
|  ERC20              ·  transfer            ·          -  ·          -  ·        32163  ·            1  ·       0.90  │
······················|······················|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  buy                 ·     103441  ·     195277  ·       155515  ·           55  ·       4.34  │
······················|······················|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  createToken         ·     331224  ·     519819  ·       515423  ·           74  ·      14.38  │
······················|······················|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  sell                ·     101147  ·     121241  ·       109421  ·           17  ·       3.05  │
······················|······················|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  claim               ·      88590  ·      93392  ·        92245  ·           10  ·       2.57  │
······················|······················|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  createDistribution  ·     112368  ·     171808  ·       152983  ·           41  ·       4.27  │
······················|······················|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  refund              ·          -  ·          -  ·        45160  ·            2  ·       1.26  │
······················|······················|·············|·············|···············|···············|··············
|  TestToken          ·  approve             ·      24259  ·      46255  ·        45990  ·           89  ·       1.28  │
······················|······················|·············|·············|···············|···············|··············
|  TestToken          ·  transfer            ·      46585  ·      51385  ·        50420  ·           56  ·       1.41  │
······················|······················|·············|·············|···············|···············|··············
|  Deployments                               ·                                           ·  % of limit   ·             │
·············································|·············|·············|···············|···············|··············
|  MCV2_Bond                                 ·          -  ·          -  ·      2804776  ·        9.3 %  ·      78.23  │
·············································|·············|·············|···············|···············|··············
|  MCV2_Token                                ·          -  ·          -  ·      1064865  ·        3.5 %  ·      29.70  │
·············································|·············|·············|···············|···············|··············
|  MerkleDistributor                         ·          -  ·          -  ·      1516326  ·        5.1 %  ·      42.29  │
·············································|·············|·············|···············|···············|··············
|  TestToken                                 ·     758947  ·     758959  ·       758953  ·        2.5 %  ·      21.17  │
·--------------------------------------------|-------------|-------------|---------------|---------------|-------------·
```
