// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _dec;
    constructor(string memory name, string memory sym, uint8 dec) ERC20(name, sym) { _dec = dec; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
