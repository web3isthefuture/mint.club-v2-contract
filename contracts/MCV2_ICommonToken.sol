// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

interface MCV2_ICommonToken {
    function totalSupply() external view returns (uint256);
    function mintByBond(address to, uint256 amount) external;
    function burnByBond(address account, uint256 amount) external;
}