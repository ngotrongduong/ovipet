---
name: regression-proof
description: Use when fixing an OviPets bug or protecting fragile behavior before refactor.
---

State failed invariant; reproduce with focused test; confirm correct failure; make smallest fix; run focused then full suite; relevant specialist review; final regression review. Test behavior/state rather than source strings whenever practical.
