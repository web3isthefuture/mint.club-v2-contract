const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const web3 = require('web3');
const {
  MAX_INT_256,
  NULL_ADDRESS,
  PROTOCOL_BENEFICIARY,
  MAX_ROYALTY_RANGE,
  MAX_STEPS,
  wei,
  modifiedValues,
  computeCreate2Address,
  calculateMint,
  calculateBurn,
  calculateRoyalty
} = require('./utils/test-utils');

const BABY_TOKEN = {
  tokenParams: { name: 'Baby Token', symbol: 'BABY', uri: 'https://api.hunt.town/token-info.json' },
  bondParams: {
    royalty: 500n, // 5%
    reserveToken: null, // Should be set later
    maxSupply: 100n,
    stepRanges: [ 10n, 30n, 50n, 100n ],
    stepPrices: [ wei(0), wei(2), wei(5), wei(10) ]
  }
};

describe('BondMultiToken', function () {
  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract('MCV2_Token');
    await TokenImplementation.waitForDeployment();

    const NFTImplementation = await ethers.deployContract('MCV2_MultiToken');
    await NFTImplementation.waitForDeployment();

    const Bond = await ethers.deployContract('MCV2_Bond', [TokenImplementation.target, NFTImplementation.target, PROTOCOL_BENEFICIARY]);
    await Bond.waitForDeployment();

    const BaseToken = await ethers.deployContract('TestToken', [wei(2000)]); // supply: 2,000
    await BaseToken.waitForDeployment();

    return [NFTImplementation, Bond, BaseToken];
  }

  let NFTImplementation, Bond, BaseToken;
  let owner, alice, bob;

  beforeEach(async function () {
    [NFTImplementation, Bond, BaseToken] = await loadFixture(deployFixtures);
    [owner, alice, bob] = await ethers.getSigners();
    BABY_TOKEN.bondParams.reserveToken = BaseToken.target; // set BaseToken address
  });

  describe.only('Create token', function () {
    beforeEach(async function () {
      const Token = await ethers.getContractFactory('MCV2_Token');
      this.creationTx = await Bond.createMultiToken(Object.values(BABY_TOKEN.tokenParams), Object.values(BABY_TOKEN.bondParams));
      this.token = await Token.attach(await Bond.tokens(0));
      this.bond = await Bond.tokenBond(this.token.target);
    });

    describe('Normal flow', function() {
      it('should create a contract addreess deterministically', async function() {
        const salt = web3.utils.soliditySha3(
          { t: 'address', v: Bond.target },
          { t: 'string', v: BABY_TOKEN.tokenParams.symbol }
        );
        const predicted = computeCreate2Address(salt, NFTImplementation.target, Bond.target);

        expect(this.token.target).to.be.equal(predicted);
      });

      it('should create token with correct parameters', async function() {
        expect(await this.token.name()).to.equal(BABY_TOKEN.tokenParams.name);
        expect(await this.token.symbol()).to.equal(BABY_TOKEN.tokenParams.symbol);
      });

      it('should mint free range tokens initially to the creator', async function () {
        expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.bondParams.stepRanges[0]);
        expect(await this.token.balanceOf(owner.address)).to.equal(BABY_TOKEN.bondParams.stepRanges[0]);
      });

      it('should set correct bond parameters', async function() {
        expect(this.bond.creator).to.equal(owner.address);
        expect(this.bond.reserveToken).to.equal(BABY_TOKEN.bondParams.reserveToken);
        expect(this.bond.maxSupply).to.equal(BABY_TOKEN.bondParams.maxSupply);
      });

      it('should set correct bond steps', async function() {
        const steps = await Bond.getSteps(this.token.target);
        for(let i = 0; i < steps.length; i++) {
          expect(steps[i][0]).to.equal(BABY_TOKEN.bondParams.stepRanges[i]);
          expect(steps[i][1]).to.equal(BABY_TOKEN.bondParams.stepPrices[i]);
        }
      });

      it('should emit MultiTokenCreated event', async function () {
        await expect(this.creationTx)
          .emit(Bond, 'MultiTokenCreated')
          .withArgs(this.token.target, BABY_TOKEN.tokenParams.name, BABY_TOKEN.tokenParams.symbol, BABY_TOKEN.tokenParams.uri);
      });

      it('should return tokenCount = 1', async function () {
        expect(await Bond.tokenCount()).to.equal(1);
      });

      it('should return true for existence check', async function () {
        expect(await Bond.exists(this.token.target)).to.equal(true);
      });
    }); // Normal flow

    describe('Validations', function () {
      beforeEach(async function () {
        this.newTokenParams = modifiedValues(BABY_TOKEN.tokenParams, { symbol: 'BABY2' });
      });

      it('should check if name is blank', async function () {
        await expect(
          Bond.createMultiToken(
            modifiedValues(BABY_TOKEN.tokenParams, { name: '' }),
            Object.values(BABY_TOKEN.bondParams)
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('name');
      });

      it('should check if symbol is blank', async function () {
        await expect(
          Bond.createMultiToken(
            modifiedValues(BABY_TOKEN.tokenParams, { symbol: '' }),
            Object.values(BABY_TOKEN.bondParams)
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('symbol');
      });

      it('should check if royalty is less than the max range', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { royalty: MAX_ROYALTY_RANGE + 1n })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('royalty');
      });

      it('should check if reserve token is valid', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { reserveToken: NULL_ADDRESS })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('reserveToken');
      });

      it('should check if max supply is valid', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { maxSupply: 0 })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('maxSupply');
      });

      it('should check if step ranges are not empty', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('INVALID_STEP_LENGTH');
      });

      it('should check if the length of step ranges are more than max steps', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [...Array(MAX_STEPS + 2).keys()].splice(1) })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('INVALID_STEP_LENGTH');
      });

      it('should check if the length of step ranges has the same length with step prices', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [100, 200], stepPrices: [1] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('STEP_LENGTH_DO_NOT_MATCH');
      });

      it('should check if the max suppply matches with the last step range', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [100, 200], stepPrices: [1, 2] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('MAX_SUPPLY_MISMATCH');
      });

      it('should check if any of step ranges has zero value', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [0, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 2] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('STEP_CANNOT_BE_ZERO');
      });

      it('should check if any of step ranges is less than the previous step', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [2, 1, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 2, 3] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('DECREASING_RANGE');
      });

      it('should check if any of step prices is less than the previous step', async function () {
        await expect(
          Bond.createMultiToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [1, 2, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 3, 2] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('DECREASING_PRICE');
      });

      it('should revert if token symbol already exists', async function () {
        await expect(Bond.createMultiToken(BABY_TOKEN.tokenParams, BABY_TOKEN.bondParams))
          .to.be.revertedWithCustomError(Bond, 'MCV2_Bond__TokenSymbolAlreadyExists');
      });

      it('should not mint any tokens if the first step price is not zero', async function () {
        await Bond.createMultiToken(
          this.newTokenParams,
          modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [1, 2, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 2, 3] })
        );

        const Token = await ethers.getContractFactory('MCV2_Token');
        this.token2 = await Token.attach(await Bond.tokens(1));
        expect(await this.token2.totalSupply()).to.equal(0);
      });

      // NOTE: This could cost up to ~13M gas, which is ~43% of the block gas limit
      // Skipping this test because this exceptional case makes the average gas cost too high
      it.skip('should check if it support up to max steps', async function () {
        await Bond.createMultiToken(
          this.newTokenParams,
          modifiedValues(BABY_TOKEN.bondParams, {
            maxSupply: MAX_STEPS,
            stepRanges: [...Array(1001).keys()].splice(1),
            stepPrices: [...Array(1001).keys()].splice(1)
          })
        );

        const Token = await ethers.getContractFactory('MCV2_Token');
        const token = await Token.attach(await Bond.tokens(1));
        const bond = await Bond.tokenBond(token.target);

        expect(await token.symbol()).to.equal('BABY2');
        expect(bond.maxSupply).to.equal(1000);
      });
    }); // Validations

    describe('Update bond creator', function () {
      beforeEach(async function () {
        await Bond.connect(owner).updateBondCreator(this.token.target, bob.address);
      });

      it('should update the creator', async function () {
        const bond = await Bond.tokenBond(this.token.target);
        expect(bond.creator).to.equal(bob.address);
      });

      it('should reject if the msg.sender is not current creator', async function () {
        await expect(Bond.connect(owner).updateBondCreator(this.token.target, bob.address))
          .to.be.revertedWithCustomError(Bond, 'MCV2_Bond__PermissionDenied');
      });

      it('should emit BondCreatorUpdated event', async function () {
        await expect(Bond.connect(bob).updateBondCreator(this.token.target, bob.address))
          .emit(Bond, 'BondCreatorUpdated')
          .withArgs(this.token.target, bob.address);
      });

      it('should send fees to the new creator', async function () {
        // stepRanges: [ 10n, 30n, 50n, 100n ] / stepPrices: [ wei(0), wei(2), wei(5), wei(10) ]
        const tokensToMint = 30n; // requires 30 * wei(2) = 60 BASE tokens
        const test = calculateMint(tokensToMint, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
        // { royalty: 10, creatorCut: 8, protocolCut: 2, reserveToBond: 1000, reserveRequired: 1010 }

        await BaseToken.transfer(alice.address, wei(9999999));
        await BaseToken.connect(alice).approve(Bond.target, MAX_INT_256);
        await Bond.connect(alice).mint(this.token.target, tokensToMint, MAX_INT_256);

        const fees = await Bond.getRoyaltyInfo(bob.address, BaseToken.target);
        expect(fees[0]).to.equal(test.creatorCut);
        expect(fees[1]).to.equal(0n);
      });
    });

    describe('Mint', function () {
      describe('Mint once', function() {
        beforeEach(async function () {
          // Start with 10000 BaseToken, purchasing BABY tokens with 1000 BaseToken
          this.initialBaseBalance = wei(1000000); // 1M BASE tokens
          this.tokensToMint = wei(500);

          this.mintTest = calculateMint(this.tokensToMint, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
          // { royalty: 10, creatorCut: 8, protocolCut: 2, reserveToBond: 1000, reserveRequired: 1010 }

          await BaseToken.transfer(alice.address, this.initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
          await Bond.connect(alice).mint(this.token.target, this.tokensToMint, MAX_INT_256);
        });

        it('should mint correct amount', async function () {
          expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint);
        });

        it('should transfer BASE tokens to the bond', async function () {
          expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance - this.mintTest.reserveRequired);
          expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.mintTest.reserveRequired); // including royalties until claimed
        });

        it('should add reserveBalance to the bond', async function () {
          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.mintTest.reserveToBond);
        });

        it('should increase the total supply', async function () {
          // BABY_TOKEN.bondParams.stepRanges[0] is automatically minted to the creator on initialization
          expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.bondParams.stepRanges[0] + this.tokensToMint);
        });

        it('should add claimable balance to the creator', async function () {
          expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(this.mintTest.creatorCut);
        });

        it('should add claimable balance to the protocol beneficiary', async function () {
          expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(this.mintTest.protocolCut);
        });

        it('should emit Mint event', async function () {
          await expect(Bond.connect(alice).mint(this.token.target, this.tokensToMint, MAX_INT_256))
            .emit(Bond, 'Mint')
            .withArgs(this.token.target, alice.address, this.tokensToMint, BaseToken.target, this.mintTest.reserveRequired);
        });
      }); // Mint once

      describe('Massive mint & burn through multiple steps', function () {
        beforeEach(async function () {
          // Calculations: https://ipfs.io/ipfs/QmXaAwVLC8MyCKiWfy1EAsoAfuZ3Fw7nSdDebckcXkcJvJ
          this.tokensToMint = wei(9990000); // 9.99M BABY tokens except 10K free mint
          this.initialBaseBalance = wei(117341800); // 117,341,800 BASE tokens required
          await BaseToken.transfer(alice.address, this.initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
          await Bond.connect(alice).mint(this.token.target, this.tokensToMint, MAX_INT_256);
          this.predicted = {
            reserveOnBond: wei(116180000),
            totalSupply: wei(10000000), // 10M = max supply
            creatorCut: wei(929440), // 116180000 * 0.01 * 0.8
            protocolCut: wei(232360) // 116180000 * 0.01 * 0.2
          }
        });

        describe('Massiv Mint', function () {
          it('should be at the last price step', async function () {
            expect(await Bond.currentPrice(this.token.target)).to.equal(BABY_TOKEN.bondParams.stepPrices[7]);
          });

          it('should mint correct amount after royalties', async function () {
            expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint);
          });

          it('should transfer BASE tokens to the bond', async function () {
            expect(await BaseToken.balanceOf(alice.address)).to.equal(0);
            expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.initialBaseBalance); // including royalty until claimed
          });

          it('should add reserveBalance to the bond', async function () {
            const bond = await Bond.tokenBond(this.token.target);
            expect(bond.reserveBalance).to.equal(this.predicted.reserveOnBond);
          });

          it('should increase the total supply', async function () {
            // BABY_TOKEN.bondParams.stepRanges[0] is automatically minted to the creator on initialization
            expect(await this.token.totalSupply()).to.equal(this.predicted.totalSupply);
          });

          it('should add claimable balance to the creator', async function () {
            expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(this.predicted.creatorCut);
          });

          it('should add claimable balance to the protocol beneficiary', async function () {
            expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(this.predicted.protocolCut);
          });

          describe('Massive Burn', function () {
            beforeEach(async function () {
              this.initial = {
                supply: await this.token.totalSupply(),
                baseBalance: await BaseToken.balanceOf(alice.address),
                tokenBalance: await this.token.balanceOf(alice.address),
                bondBalance: await BaseToken.balanceOf(Bond.target),
                bondReserve: (await Bond.tokenBond(this.token.target)).reserveBalance
              };

              // Burn all BABY tokens Alice has
              await this.token.connect(alice).approve(Bond.target, MAX_INT_256);

              await Bond.connect(alice).burn(this.token.target, this.initial.tokenBalance, 0);
            });

            it('should burn all BABY tokens from alice', async function () {
              expect(await this.token.balanceOf(alice.address)).to.equal(0);
            });

            it('should transfer BASE tokens to alice', async function () {
              const { total } = calculateRoyalty(this.initial.bondReserve, BABY_TOKEN.bondParams.royalty);
              const toRefund =  this.initial.bondReserve - total;
              expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initial.baseBalance + toRefund);
            });

            it('should decrease the total supply', async function () {
              expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.bondParams.stepRanges[0]); // except the free minting amount
            });

            it('should decrease the reserveBalance on the bond', async function () {
              const bond = await Bond.tokenBond(this.token.target);
              expect(bond.reserveBalance).to.equal(0);
            });

            it('should add claimable balance to the creator', async function () {
              // mint + burn = 2
              const royalty = calculateRoyalty(this.initial.bondReserve * 2n, BABY_TOKEN.bondParams.royalty);

              expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(royalty.creatorCut);
            });

            it('should add claimable balance to the protocol', async function () {
              const royalty = calculateRoyalty(this.initial.bondReserve * 2n, BABY_TOKEN.bondParams.royalty);

              expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(royalty.protocolCut);
            });

            it('should leave claimable royalty balance on the bond', async function () {
              const royalty = calculateRoyalty(this.initial.bondReserve * 2n, BABY_TOKEN.bondParams.royalty);

              expect(await BaseToken.balanceOf(Bond.target)).to.equal(royalty.total);
            });
          }); // Massive Burn
        }); // Massive Mint
      }); // Massive mint & burn through multiple steps

      describe('Burn', function () {
        beforeEach(async function () {
          // Mint 500 BABY tokens with 1010 BASE (fee: 10 BASE)
          const initialBaseBalance = wei(1010);
          const tokensToMint = wei(500);

          this.mintTest = calculateMint(tokensToMint, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
          // { royalty: 10, creatorCut: 8, protocolCut: 2, reserveToBond: 1000, reserveRequired: 1010 }

          await BaseToken.transfer(alice.address, initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, initialBaseBalance);
          await Bond.connect(alice).mint(this.token.target, tokensToMint, MAX_INT_256);

          this.initial = {
            supply: await this.token.totalSupply(), // 10,500
            baseBalance: await BaseToken.balanceOf(alice.address), // 0
            tokenBalance: await this.token.balanceOf(alice.address), // 500
            bondBalance: await BaseToken.balanceOf(Bond.target), // 1010
            bondReserve: (await Bond.tokenBond(this.token.target)).reserveBalance // 1000
          };
          this.tokensToBurn = wei(100);

          // current price: wei(2)
          this.burnTest = calculateBurn(this.tokensToBurn, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
          // { royalty: 10, creatorCut: 8, protocolCut: 2, reserveFromBond: 200, reserveToRefund: 190 }

          await this.token.connect(alice).approve(Bond.target, MAX_INT_256);
          await Bond.connect(alice).burn(this.token.target, this.tokensToBurn, 0);
        });

        it('should decrease the BABY tokens from Alice', async function () {
          expect(await this.token.balanceOf(alice.address)).to.equal(this.initial.tokenBalance - this.tokensToBurn);
        });

        it('should transfer correct amount of BASE tokens to Alice', async function () {
          expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initial.baseBalance + this.burnTest.reserveToRefund);
        });

        it('should decrease the BASE tokens balance from the bond', async function () {
          // royalty is not claimed yet
          expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.initial.bondBalance - this.burnTest.reserveToRefund);
        });

        it('should decrease the total supply of BABY token', async function () {
          expect(await this.token.totalSupply()).to.equal(this.initial.supply - this.tokensToBurn);
        });

        it('should deduct reserveBalance from the bond', async function () {
          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.initial.bondReserve - this.burnTest.reserveFromBond);
        });

        it('should add claimable balance to the creator', async function () {
          expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(
            this.mintTest.creatorCut + this.burnTest.creatorCut
          );
        });

        it('should add claimable balance to the protocol beneficiary', async function () {
          expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(
            this.mintTest.protocolCut + this.burnTest.protocolCut
          );
        });

        it('should emit Burn event', async function () {
          await expect(Bond.connect(alice).burn(this.token.target, this.tokensToBurn, 0))
            .emit(Bond, 'Burn')
            .withArgs(this.token.target, alice.address, this.tokensToBurn, BaseToken.target, this.burnTest.reserveToRefund);
        });
      }); // Burn
    }); // Mint

    describe('Other Edge Cases', function() {
      describe('Mint: Edge Cases', function() {
        beforeEach(async function () {
          this.initialBaseBalance = wei(200000000); // 200M
          await BaseToken.transfer(alice.address, this.initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
        });

        it('should revert if the pool does not exists', async function () {
          await expect(
            Bond.connect(alice).mint(BaseToken.target, 100n, MAX_INT_256)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__TokenNotFound');
        });

        it('should revert if the minTokens parameter is set more than the expected value', async function () {
          const tokensToMint = wei(10);
          const test = calculateMint(tokensToMint, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
          await expect(
            Bond.connect(alice).mint(this.token.target, tokensToMint, test.reserveRequired - 1n)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });

        it('should revert if the slippage limit exceeded due to a front-run', async function () {
          const tokensToMint = wei(10);
          const test = calculateMint(tokensToMint, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);

          // front-run till the next price step (price becomes 3 after 100k tokens, 180k reserve)
          await Bond.connect(alice).mint(this.token.target, BABY_TOKEN.bondParams.stepRanges[1], MAX_INT_256);

          await expect(
            Bond.connect(alice).mint(this.token.target, tokensToMint, test.reserveRequired)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });

        it('should revert if alice try to burn more than approved', async function () {
          await BaseToken.connect(alice).approve(Bond.target, 0);

          await expect(
            Bond.connect(alice).mint(this.token.target, 100n, MAX_INT_256)
          ).to.be.revertedWith('ERC20: insufficient allowance');
        });

        it('should revert if reserve amount is zero', async function () {
          await expect(
            Bond.connect(alice).mint(this.token.target, 0, MAX_INT_256)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenAmount');
        });

        it('should revert if user try to mint more than the available supply', async function () {
          const maxTokensToMint = BABY_TOKEN.bondParams.stepRanges[BABY_TOKEN.bondParams.stepRanges.length - 1] -
            BABY_TOKEN.bondParams.stepRanges[0]; // except free minting

          await expect(
            Bond.connect(alice).mint(this.token.target, maxTokensToMint + 1n, MAX_INT_256)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__ExceedMaxSupply');

          await expect(
            Bond.connect(alice).mint(this.token.target, maxTokensToMint, MAX_INT_256)
          ).not.to.be.reverted;
        });

        it('should revert if user try to mint more than the balance', async function () {
          const tokensToMint = wei(100);
          const test = calculateMint(tokensToMint, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
          await BaseToken.connect(alice).transfer(owner.address, this.initialBaseBalance - test.reserveRequired);

          await expect(
            Bond.connect(alice).mint(this.token.target, tokensToMint + 1n, MAX_INT_256)
          ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });
      }); // Mint: Edge Cases

      describe('Burn: Edge Cases', function() {
        beforeEach(async function () {
          this.initialBaseBalance = wei(200000000); // 200M
          this.tokensToMint = wei(100);
          await BaseToken.transfer(alice.address, this.initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
          await Bond.connect(alice).mint(this.token.target, this.tokensToMint, MAX_INT_256);
        });

        it('should revert if the burn amount is 0', async function () {
          await expect(
            Bond.connect(alice).burn(this.token.target, 0, 0)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenAmount');
        });

        it('should revert if it did not approve', async function () {
          await expect(
            Bond.connect(alice).burn(this.token.target, 100n, 0)
          ).to.be.revertedWith('ERC20: insufficient allowance');
        });

        it('should revert if alice try to burn more than the available balance', async function () {
          await this.token.connect(alice).approve(Bond.target, this.tokensToMint + 1n);

          await expect(
            Bond.connect(alice).burn(this.token.target, this.tokensToMint + 1n, 0)
          ).to.be.revertedWith('ERC20: burn amount exceeds balance');
        });

        it('should revert if alice try to burn more than the total supply', async function () {
          // transfer all free minted tokens to alice
          await this.token.transfer(alice.address, await this.token.balanceOf(owner.address));
          const amount = await this.token.balanceOf(alice);
          const totalSupply = await this.token.totalSupply();
          expect(amount).to.equal(totalSupply);

          await this.token.connect(alice).approve(Bond.target, amount + 1n);
          await expect(
            Bond.connect(alice).burn(this.token.target, amount + 1n, 0)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__ExceedTotalSupply');
        });

        it('should revert if the caller receives a smaller amount than minRefund', async function () {
          const burnAmount = wei(100);
          const { reserveToRefund } = calculateBurn(burnAmount, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
          await this.token.connect(alice).approve(Bond.target, burnAmount);

          await expect(
            Bond.connect(alice).burn(this.token.target, burnAmount, reserveToRefund + 1n)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });

        it('should revert if the slippage limit exceeded due to a front-run', async function () {
          const burnAmount = wei(100);
          const { reserveToRefund } = calculateBurn(burnAmount, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
          await this.token.connect(alice).approve(Bond.target, burnAmount);

          // Front-run the transaction - owner rugs the pool
          await this.token.connect(owner).approve(Bond.target, BABY_TOKEN.bondParams.stepRanges[0]);
          await Bond.connect(owner).burn(this.token.target, BABY_TOKEN.bondParams.stepRanges[0], 0);

          await expect(
            Bond.connect(alice).burn(this.token.target, burnAmount, reserveToRefund)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });
      }); // Burn: Edge Cases
    }); // Other Edge Cases
  }); // Create token

  describe('Edge cases: Rounding errors', function() {
    beforeEach(async function () {
      const EXTREME_BABY = {
        tokenParams: {
          name: 'Baby Token',
          symbol: 'BABY'
        },
        bondParams: {
          royalty: 100n, // 1%
          reserveToken: BaseToken.target,
          maxSupply: 100n,
          stepRanges: [10n, 30n, 100n],
          stepPrices: [7n, 8n, 9n]
        }
      };

      await Bond.createMultiToken(Object.values(EXTREME_BABY.tokenParams), Object.values(EXTREME_BABY.bondParams));
      const Token = await ethers.getContractFactory('MCV2_Token');
      this.token = await Token.attach(await Bond.tokens(0));

      this.initialBaseBalance = 10000n;
      await BaseToken.transfer(alice.address, this.initialBaseBalance);
      await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
    });

    it('does not collect any royalties if the amount is too small, due to flooring', async function () {
      // minting 10 BABY requires 70.7 BASE, but it will be floored to 70
      await Bond.connect(alice).mint(this.token.target, 10n, MAX_INT_256);

      expect(await this.token.balanceOf(alice.address)).to.equal(10n);
      expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance - 70n);

      const bond = await Bond.tokenBond(this.token.target);
      expect(bond.reserveBalance).to.equal(70n);

      expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(0n);
      expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(0n);
    });

    it('requires exact bond amount even if the royalty is omitted due to flooring', async function () {
      // minting 100 BABY requires 10*7 + 20*8 + 70*9 = 860 BASE + 8.6 royalty
      // after flooring:
      const tokensToMint = 100n;
      const predicted = {
        reserveOnBond: 860n,
        reserveRequired: 868n,
        royalty: 8n, // 8.6 floored
        protocolCut: 1n, // 8.6 * 0.2 = 1.72 floored
        creatorCut: 7n
      }

      await Bond.connect(alice).mint(this.token.target, tokensToMint, MAX_INT_256);

      expect(await this.token.balanceOf(alice.address)).to.equal(tokensToMint);
      expect((await Bond.tokenBond(this.token.target)).reserveBalance).to.equal(predicted.reserveOnBond);
      expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance - predicted.reserveRequired);
      expect(await BaseToken.balanceOf(Bond.target)).to.equal(predicted.reserveRequired);
      expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(predicted.creatorCut);
      expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(predicted.protocolCut);
    });
  }); // Rounding errors

  describe('Utility functions', function () {
    beforeEach(async function () {
      this.BaseToken2 = await ethers.deployContract('TestToken', [wei(200000000)]);
      await this.BaseToken2.waitForDeployment();

      const BABY_TOKEN2 = structuredClone(BABY_TOKEN);
      BABY_TOKEN2.tokenParams.symbol = 'BABY2';
      BABY_TOKEN2.bondParams.reserveToken = this.BaseToken2.target;

      const BABY_TOKEN3 = structuredClone(BABY_TOKEN);
      BABY_TOKEN3.tokenParams.symbol = 'BABY3';
      BABY_TOKEN3.bondParams.reserveToken = this.BaseToken2.target;

      await Bond.connect(alice).createMultiToken(...Object.values(BABY_TOKEN));
      await Bond.connect(alice).createMultiToken(...Object.values(BABY_TOKEN2));
      await Bond.connect(bob).createMultiToken(...Object.values(BABY_TOKEN3));
    });

    it('should return [0] for ReserveToken = BaseToken', async function () {
      const ids = await Bond.getTokenIdsByReserveToken(BaseToken.target);
      expect(ids).to.deep.equal([0]);
    });

    it('should return [1, 2] for ReserveToken = BaseToken2', async function () {
      const ids = await Bond.getTokenIdsByReserveToken(this.BaseToken2.target);
      expect(ids).to.deep.equal([1, 2]);
    });

    it('should return [0, 1] for creator = alice', async function () {
      const ids = await Bond.getTokenIdsByCreator(alice.address);
      expect(ids).to.deep.equal([0, 1]);
    });

    it('should return [2] for creator = bob', async function () {
      const ids = await Bond.getTokenIdsByCreator(bob.address);
      expect(ids).to.deep.equal([2]);
    });
  }); // Utility functions
}); // Bond