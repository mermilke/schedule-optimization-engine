# How the assignment algorithm works

## The problem

Each cycle brings hundreds of sign-ups across the event, more than the slots can hold — there are 49 slots per track on each day. Each player picks a preferred time and some alternates, plus a "speedups" number (their contribution value — higher is better). For each track I want the 49 players with the most speedups to get slots, and as many of them as possible to actually fit.

This is basically a maximum weight bipartite matching problem — players on one side, slots on the other, edges where a player is available, and you want to maximize total weight (speedups) of the matched set. But with a twist: I care about maximizing the *count* of top-49 players first, then maximizing their speedups second.

The catch: some players are flexible (30+ available times) and some are constrained (2-3 times). If you just assign the highest-speedup player first, they might grab a slot that was the only option for someone else.

## Why simple greedy doesn't work

Example — if you assign highest speedups first:

```
Player 1  (150 speedups, 33 available slots)   -> gets 02:45
Player 2  (136 speedups)                        -> gets 01:15
Player 3  (52 speedups, only 01:15 or 02:45)    -> both taken, unassigned
```

Player 1 had 32 other options. Player 3 had 2. Bad outcome.

## What I do instead

### 1. Pick the top 49

Sort everyone by speedups, take the top 49. These are the people who should get in.

```javascript
normal.sort(function(a, b) { return b.speedups - a.speedups; });
var selected = mustAssign.concat(normal.slice(0, normalCut));
```

(`mustAssign` = players with the ASSIGN override, they always make the cut)

### 2. Assign constrained-first

Among those 49, sort by how many available times they have (ascending). Players with fewer options go first.

```javascript
var constrained = selected.slice().sort(function(a, b) {
  var diff = a.allAvail.length - b.allAvail.length;
  return diff !== 0 ? diff : b.speedups - a.speedups;
});
```

Each player tries their preferred slot, then alternates sorted by proximity (circular distance for midnight wrap). Now Player 3 gets 02:45 because they only had 2 options, and Player 1 gets 13:45 from their pile of 33.

### 3. Bump/swap

If any of the top 49 still couldn't fit (all their times were taken by other top players), look for the lowest-speedup assigned player sitting in one of their available slots.

Try to relocate that player to an open alternate first — if that works, nobody loses a spot. If they can't relocate, bump them out entirely.

### 4. Backfill

Whatever slots are still open after the top 49 are placed, fill them with the remaining players (highest speedups first).

## Day 4: two tracks

Day 4 has Noble Advisor (primary, 49 slots) and Chief Minister (overflow, 49 more slots). The algorithm runs for Noble first, then all unassigned players get passed to a second run for Chief Minister.

Players can be forced to a specific track with `CHIEF` or `NOBLE` in the override column.

## Crossover handling

Day 1's last slot (23:45) and Day 2's first slot (00:00) need to be the same person — they're covering the midnight boundary. After Day 1 is assigned, the script checks who got 23:45, verifies they signed up for Day 2, and reserves the 00:00 slot for them before running Day 2's algorithm.

## Performance

Each track is 49 slots matched against hundreds of sign-ups across the cycle. The whole thing runs in under a second. The real bottleneck is Google Sheets API calls (reading/writing cells), not the algorithm.
