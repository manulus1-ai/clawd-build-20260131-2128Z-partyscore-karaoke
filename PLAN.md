# Implementation plan (PartyScore Karaoke)

Source: `idea-refinements/20-partyscore-karaoke.md`

## Checklist (10–25 steps)
1. Create repo skeleton with `/frontend` (Angular) + README.
2. Scaffold Angular app with minimal deps.
3. Convert to standalone `AppComponent` and bootstrap via `bootstrapApplication`.
4. Implement mic onboarding flow (permission + error state).
5. Implement Web Audio pipeline (MediaStreamSource → AnalyserNode).
6. Add animation loop to compute live energy meter (RMS).
7. Implement lightweight pitch estimation (autocorrelation) with vocal range gating.
8. Build one-screen arcade UI: onboarding → ready → singing → results.
9. Implement 10-second round timer + stop/finish logic.
10. Compute fun-first score from energy + pitch stability + pitch variety.
11. Add leaderboard (localStorage) and personal best tracking.
12. Add “challenge link” format via URL params (`name`, `score`).
13. Add share UX: Web Share API if available; clipboard fallback + toast.
14. Add confetti effect on personal best.
15. Tune UI for mobile (responsive layout).
16. Increase Angular style budgets to allow arcade CSS.
17. Add GitHub Pages workflow (build with repo base-href, deploy with Pages actions).
18. Enable GitHub Pages (build_type=workflow) and verify deploy succeeds.
19. Document local run + Pages build commands.
20. Record run in cron state file to avoid repeats.
