# Reply to App Review: Guidelines 4.3 and 4.2.6 (Mafia God)

Paste the English text below into App Store Connect → Mafia God → App Review
(Resolution Center) → Reply. Do **not** resubmit; Apple asks for a reply
when the app is not spam. Answer 5 lists Shah Dozd Vazir, Tiaro and Adadi;
add or remove apps to match what is on this developer account. Keep the
paragraph about submitting several apps together the same in every reply.

---

Hello, and thank you for the review. I believe Mafia God is not a duplicate, not an opportunistic variant and not built from a template, so I am replying instead of resubmitting. My answers:

**1. What the app does and the problem it solves**

Mafia God is a tool for the narrator (the "god") of the in-person Mafia party game, as it is played in Iran and in Russian-speaking clubs. In these versions a large group plays with many special roles, and the narrator has to:

- deal secret roles without anyone seeing,
- wake each role in the right order every night and remember everyone's choices,
- work out who survives,
- run timed speeches and a two-round vote.

On paper this means slips, notes and a lot of mental bookkeeping. Mistakes ruin the game, and the narrator cannot play.

The app does that bookkeeping. It deals roles on one phone (each player taps their name, sees their card and hides it) and walks the narrator through the night in the scenario's order, recording each role's choice. It then works out the interactions: the doctor's save, the Godfather appearing innocent to the detective, the sniper's risk, the hostage-taker, the tough role's shield. In the morning it gives one clear announcement and keeps the secret notes for the narrator. It also has a talk timer and a vote counter with a threshold and a second round.

**2. Intended users**

The people who run Mafia nights: friend groups, families at gatherings, cafés and clubs that hold regular games. It is mainly for Persian speakers, for whom Mafia is one of the most popular party games, with scenarios that clubs play. It also serves Arabic- and Russian-speaking groups, and English-speaking players who know the game as Mafia or Werewolf.

**3. The need it addresses**

- **Real scenarios, not just a card dealer.** Seven ready-made scenarios with their own roles and night order. They include the Iranian club scenarios (for example Takavar and Bazpors, with roles such as the Godfather, the hostage-taker and the commando), the classic ones, and Russian sport and city mafia. A narrator can also build their own roles and save their own scenarios.
- **The night is resolved for the narrator.** The app knows how the roles interact, so the narrator does not have to track them in their head.
- **Club identity.** A group can put its own name, logo and colour on every screen and on the back of the role cards, which matters for clubs.
- **Languages.** Persian first (right to left, Persian digits), plus Arabic, Russian and English, with each scenario in the languages where it is played.
- **Offline and private.** No account, no ads, no tracking, no purchases. The optional recovery code saves the group's roles, scenarios and logo encrypted end to end: the server only stores ciphertext under a hash of the code and cannot read it.

**4. Beta testing and feedback applied**

I am an individual developer working alone, so I did the testing myself: I installed the TestFlight builds on my iPhone and the Android test builds on my Android phone, and ran full games (deal, nights, votes) in each scenario and language. Problems I found and fixed:

- Choosing roles first and the player count later was confusing, so the app now asks for the player count and the scenario first.
- iPhone zoomed the screen in unexpectedly, so I fixed it.
- One round of voting was not how real games are played, so I added the two-round vote with a threshold and a defence.
- I added iPad support, so the app works properly on iPad.
- Groups want their own identity and house rules, so I added group branding (name, logo, colour), custom roles and saved scenarios.
- I added the ready-made scenarios one by one and checked each night order.
- The language picker was hard to find in Settings, so it is now first.
- I tried Urdu but removed it until I can review it properly.
- I redesigned the app icon.

**5. Standalone or part of a suite**

Mafia God is a standalone app. This is my personal developer account; Espadna is the name I publish my games under. I built my apps separately, one at a time, each with its own code, rules and art. Once my developer account was ready, I submitted the ones that were finished within a short time, which is why several reached review together. I will space out future submissions. My other apps on the App Store:

- Shah Dozd Vazir: a short traditional game for 4 to 6 people, with fixed roles, one guess per round and point scoring. There is no narrator, no night and no voting.
- Tiaro: a single-player daily logic puzzle.
- Adadi: a single-player math crossword.

Mafia God is the only tool for a narrator, the only one with night actions, elimination and voting, and the only one for large groups.

**6. Could it be an in-app purchase or an addition to another app?**

No. The nearest app, Shah Dozd Vazir, is a different traditional game with its own rules, where everyone plays and the app keeps score. Mafia God is a tool for one person, the narrator, running a long elimination game with scenarios, night actions and voting. Their users, rules and screens have nothing in common, and players look for each game by its own name.

**7. Code, frameworks or assets shared with my other apps**

Mafia God is its own web codebase (HTML, CSS and JavaScript) inside a Capacitor shell, written for this app: the role and scenario logic, night resolution, voting, branding, screens and texts. One small native helper of about 160 lines, which connects to Game Center (rankings and medals) and iCloud key-value storage, was written for Mafia God first. Shah Dozd Vazir uses an adapted copy of it. My build and upload scripts are shared too, but they are not part of any app. Fonts are standard open-source fonts.

**8. Codebase, SDK or content shared with a third party**

No, beyond standard frameworks: Capacitor (Apple's WKWebView inside a native shell) and Apple's GameKit. No template, white-label product or app-generation service was used. The scenarios are based on how the game is traditionally played; the texts, role descriptions, logic and art are my own.

**9. Created for a client or third party?**

No. I am an individual developer and this is my own account; Espadna is just my brand name, not a company or a client. The idea, the content and the branding are mine. Nothing was supplied by a client, partner or template provider.

Thank you for taking another look. I am happy to provide a short video of a game being narrated with the app if that helps.

---
