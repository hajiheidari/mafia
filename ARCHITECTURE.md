# معماری پیاده‌سازی‌شده — پلتفرم بازی‌های دورهمی فارسی

> این سند، معماری تأییدشده را مستند می‌کند و وضعیت واقعی پیاده‌سازی فاز ۱ را نشان می‌دهد.

## وضعیت پیاده‌سازی (فاز ۱)

| Milestone | وضعیت |
|---|---|
| ۱. بنیان پروژه (مونوریپو، Next.js، Fastify، پکیج‌ها) | ✅ کامل و تست‌شده |
| ۲. دیتابیس (Prisma schema، جداول core، تست روی Postgres واقعی) | ✅ schema و migration تأیید شده روی Postgres محلی؛ جزئیات محدودیت شبکه‌ی sandbox در README |
| ۳. احراز هویت مهمان (کوکی HttpOnly، access/refresh) | ✅ کامل و تست‌شده روی Postgres/Redis واقعی |
| ۴. سیستم اتاق (ایجاد/join/host controls) | ✅ کامل و تست‌شده (ایجاد، join با کد، ظرفیت، ready، حذف بازیکن توسط host، بررسی permission سمت سرور) |
| ۵. Realtime (Socket.IO رویدادها، reconnection) | ✅ کامل و تست‌شده (۲۴ تست خودکار + reconnection خودکار واقعی + پشتیبانی چند-تب) |
| ۶. Lobby UX نهایی | ✅ کامل و تست‌شده (۶۷ تست خودکار + تأیید کامل two-browser روی سرور واقعی) |

Game Engine عمومی (registry، pipeline اکشن، رویدادها، versioning، idempotency) و تست خودکار نشت اطلاعات از ابتدا پیاده‌سازی و تأیید شده‌اند (بخش‌های ۳، ۷، ۸ همین سند) — چون این‌ها زیربنای همه‌ی milestoneهای بعدی هستند.

---

---

## ۱. مدل احراز هویت مهمان (Guest Session)

**مشکل نسخه‌ی قبل:** نگه‌داشتن `guestSecret` در `localStorage` یعنی یک credential طولانی‌مدت حساس روی کلاینت است که در معرض XSS قرار دارد.

**مدل پیشنهادی جدید:**

- سرور یک **HttpOnly, Secure, SameSite=Lax cookie** به نام `session` صادر می‌کند (نه در دسترس JavaScript).
- این cookie فقط یک **opaque session id** کوتاه‌مدت است (مثلاً TTL چند ساعته)، نه خود secret کاربر.
- روی سرور، `sessionId → { userId, isGuest, deviceHint }` در **Redis** نگه‌داری می‌شود.
- هویت واقعی کاربر (`userId`) در Postgres است؛ کوکی فقط اشاره‌گر به سشن است.
- وقتی access token (JWT کوتاه‌عمر، ۱۵ دقیقه) منقضی شود، کلاینت با همان کوکی HttpOnly یک `refresh` بی‌صدا به سرور می‌زند و توکن جدید می‌گیرد — بدون اینکه هیچ secret در دسترس JS باشد.
- اگر کاربر کوکی را از دست بدهد (پاک‌سازی مرورگر) ولی هنوز در حافظه‌ی تب باز است، در حین قطعی موقت شبکه صرفاً reconnect با همان access token جاری در حافظه انجام می‌شود؛ کوکی فقط برای refresh بعد از بستن/بازکردن تب لازم است.
- **چرا امن‌تر است:** حتی اگر XSS رخ دهد، مهاجم به کوکی HttpOnly دسترسی ندارد؛ حداکثر می‌تواند access token کوتاه‌عمر جاری در حافظه را بخواند که خودش ظرف دقایقی بی‌اثر می‌شود.

**معماری Provider-based (بدون تغییر در اصل):**

```ts
interface AuthProvider {
  id: 'guest' | 'phone' | 'email' | 'google' | 'apple';
  authenticate(input): Promise<{ userId: string; sessionId: string }>;
  refresh(sessionId): Promise<{ accessToken: string }>;
}
```

افزودن `PhoneAuthProvider` یا `GoogleAuthProvider` بعداً فقط یعنی یک پیاده‌سازی جدید از همین interface؛ مکانیزم کوکی/سشن/refresh برای همه‌ی provider ها یکسان می‌ماند. وقتی کاربر مهمان بعداً شماره‌موبایل تأیید کند، همان `userId` را نگه می‌داریم و فقط رکورد `AuthMethod` اضافه می‌شود (upgrade، نه کاربر جدید).

---

## ۲. Redis — چه چیزی در MVP لازم است، چه چیزی برای Scale

هدف: **MVP روی یک instance سرور کار کند**، ولی معماری برای افقی‌شدن آماده باشد.

| قابلیت Redis | لازم در فاز ۱ (تک-سرور)؟ | دلیل |
|---|---|---|
| Session store (`sessionId → user`) | ✅ بله | حتی تک-سرور هم بهتر است session را در memory process نگه ندارد (با ری‌استارت سرور از دست نرود) |
| Presence (کاربر آنلاین/آفلاین) | ✅ بله | با TTL ساده (`SETEX presence:<userId>`)، مستقل از تعداد instance |
| Room state cache | ⚠️ اختیاری | در فاز ۱ می‌تواند state فعال بازی فقط در Postgres (`GameSession.state`) + یک لایه‌ی in-memory ساده روی همان process باشد؛ Redis اینجا صرفاً optimization است نه ضرورت |
| **Socket.IO Redis Adapter (Pub/Sub بین instanceها)** | ❌ خیر | فقط وقتی لازم است که بیش از یک instance سرور Socket.IO داشته باشیم. در فاز ۱ با یک instance، broadcast داخل همان process کافی است |
| Rate limiting (چت/اکشن) | ✅ بله | ساده و سبک، از همان ابتدا جلوی spam را می‌گیرد |

**نتیجه:** Redis از روز اول در stack هست (برای session و presence و rate-limit)، اما **Socket.IO Adapter و هرگونه هماهنگی چند-instance غیرفعال/عدم‌نیاز** است تا وقتی که واقعاً به بیش از یک سرور نیاز پیدا کنیم. کد به‌گونه‌ای نوشته می‌شود که فعال‌کردن adapter در آینده فقط یک تغییر پیکربندی باشد، نه بازنویسی.

---

## ۳. معماری رویداد-محور (Event-Driven Game Engine)

جریان جدید هر اکشن:

```
Action → validateAction() → applyAction() → [ domain events ] → persist(GameEvent) → broadcast()
```

`applyAction` دیگر فقط state جدید برنمی‌گرداند؛ یک آرایه از رویدادهای دامنه هم تولید می‌کند:

```ts
interface ActionResult<TState> {
  nextState: TState;
  events: DomainEvent[];
}

type DomainEvent =
  | { type: 'PLAYER_JOINED'; playerId: string }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | { type: 'PLAYER_READY'; playerId: string }
  | { type: 'GAME_STARTED' }
  | { type: 'PHASE_STARTED'; phase: string; endsAt: number }
  | { type: 'TURN_STARTED'; playerId: string }
  | { type: 'PLAYER_ACTION'; playerId: string; actionType: string }
  | { type: 'PLAYER_VOTED'; playerId: string; targetId: string }
  | { type: 'PLAYER_ELIMINATED'; playerId: string }
  | { type: 'GAME_FINISHED'; winnerSide: string };
```

هر رویداد در جدول `GameEvent` ذخیره می‌شود (append-only). این طراحی از روز اول رایگان به ما می‌دهد:

- **Debugging** — لاگ کامل تاریخچه‌ی هر بازی.
- **Analytics** — همان رویدادها به یک event-bus داخلی (in-process فعلاً) publish می‌شوند؛ بعداً می‌تواند به سیستم آنالیتیکس خارجی وصل شود بدون تغییر Game Engine.
- **Reconnection** — کلاینت می‌تواند رویدادهای بعد از `stateVersion` خودش را بگیرد یا کلاً full-sync کند.
- **Game history / Replay (آینده)** — چون رویدادها append-only و ترتیب‌دار هستند، replay یعنی صرفاً پخش دوباره‌ی همان رویدادها روی state اولیه — چیزی که الان پیاده نمی‌کنیم اما مدل داده مانع آن نیست.
- **Spectator mode (آینده)** — چون broadcast بر اساس `getPlayerView` است، اضافه‌کردن نقش «تماشاگر» یعنی یک view filter جدید، نه تغییر engine.

مهم: هنوز **replay و spectator را پیاده نمی‌کنیم**؛ فقط مطمئن می‌شویم داده و جریان رویداد این‌ها را بلاک نمی‌کند.

---

## ۴. عضویت در اتاق (Room Membership)

`RoomPlayer` نسخه‌ی قبل جایگزین `RoomMember` می‌شود تا فرض غلط «هرکسی در اتاق = بازیکن» از بین برود:

```
RoomMember (id, roomId, userId, role, isReady, joinedAt, leftAt, socketId)
```

```ts
type RoomRole = 'HOST' | 'PLAYER' | 'SPECTATOR' | 'NARRATOR' | 'MODERATOR' | 'ADMIN';
```

- در فاز ۱ فقط `HOST` و `PLAYER` واقعاً استفاده می‌شوند.
- `SPECTATOR`, `NARRATOR`, `MODERATOR` از همان الان در enum و در permission-matrix تعریف‌شده‌اند اما هیچ UI/منطقی برایشان نمی‌سازیم.
- یک لایه‌ی `RoomPermissions` بر اساس `role` تصمیم می‌گیرد چه کسی می‌تواند: بازی را شروع کند، تنظیمات را عوض کند، پیام بفرستد، اکشن بازی بزند. این یعنی مثلاً بعداً «ناظر» به‌طور طبیعی می‌تواند وارد اتاق شود ولی اکشن بازی نزند — بدون تغییر مدل داده.

---

## ۵. اتاق عمومی و خصوصی

```ts
type RoomVisibility = 'PRIVATE' | 'PUBLIC';
```

فیلدهای جدید در `Room`:

```
visibility        RoomVisibility   (پیش‌فرض PRIVATE)
skillRating        Int?            (رزرو برای matchmaking آینده، فعلاً استفاده نمی‌شود)
queueStatus         String?        (رزرو برای صف matchmaking آینده)
```

- در فاز ۱ فقط `PRIVATE_ROOM` (join با کد/لینک) پیاده می‌شود.
- یک endpoint ساده‌ی `GET /api/rooms?visibility=PUBLIC` از همان اول در API طراحی می‌شود (حتی اگر فاز ۱ فقط لیست خالی/پایه برگرداند) تا بعداً «کشف اتاق عمومی» فقط پرکردن همین endpoint باشد، نه معماری جدید.
- matchmaking/رنکینگ/تورنومنت **پیاده نمی‌شوند**، فقط فیلدهایشان در schema رزرو شده تا migration بزرگ لازم نشود.

---

## ۶. ایزوله‌سازی ماژول بازی (بدون تغییر در اصل)

Core Platform و Game Engine هیچ importی از `packages/games/mafia` ندارند. `GameRegistry` تنها نقطه‌ی اتصال است. این اصل در نسخه‌ی جدید دست‌نخورده باقی می‌ماند و در بخش‌های بالا (رویدادها، عضویت، ویزیبیلیتی) هم رعایت شده — هیچ‌کدام state خاص مافیا را نمی‌شناسند.

---

## ۷. مدل امنیتی و تست‌های نشت اطلاعات

قانون: **`state` کامل هرگز مستقیماً serialize/broadcast نمی‌شود.** فقط خروجی `getPlayerView(state, playerId)` به شبکه می‌رود — در همه‌ی مسیرها:

- پاسخ اولیه هنگام join
- broadcast بعد از هر اکشن
- پاسخ `SYNC` هنگام reconnection
- هرگونه debug/log که به کلاینت برگردد (لاگ‌های سمت سرور از این قانون مستثنی‌اند چون به کلاینت نمی‌روند)

**تست خودکار نشت اطلاعات (الزامی، در سطح Game Engine نه هر بازی جدا):**

یک تست عمومی که برای **هر** `GameDefinition` ثبت‌شده در Registry به‌صورت خودکار اجرا می‌شود:

```ts
test.each(GameRegistry.all())('%s: no player view leaks other players\' secrets', (game) => {
  const state = game.createInitialState(mockPlayers, game.defaultConfig);
  for (const player of mockPlayers) {
    const view = game.getPlayerView(state, player.id);
    const viewStr = JSON.stringify(view);
    for (const other of mockPlayers) {
      if (other.id === player.id) continue;
      expect(viewStr).not.toContain(other.secretRole); // یا هر فیلد حساس تعریف‌شده در contract
    }
  }
});
```

چون این تست در سطح Engine و Registry نوشته می‌شود، هر بازی جدید (جاسوس، اسم‌فامیل) **به‌صورت خودکار** تحت همین بررسی قرار می‌گیرد بدون نیاز به نوشتن تست جدید — یک محافظ ساختاری، نه وابسته به انضباط توسعه‌دهنده‌ی هر بازی.

---

## ۸. مدل Reconnection

هر اکشنی که کلاینت می‌فرستد شامل:

```ts
interface ActionEnvelope {
  actionId: string;        // idempotency key (UUID تولیدشده در کلاینت)
  clientStateVersion: number;
  action: GameAction;
}
```

روی سرور:

1. اگر `actionId` قبلاً پردازش شده (در Redis با TTL کوتاه چک می‌شود) → پاسخ همان نتیجه‌ی قبلی، بدون اجرای دوباره (جلوگیری از duplicate/replay).
2. اگر `clientStateVersion < serverStateVersion` → به کلاینت `SYNC_REQUIRED` با `stateVersion` فعلی و کامل `getPlayerView` جدید فرستاده می‌شود.
3. در غیر این صورت اکشن عادی پردازش می‌شود.

هنگام reconnect (رویداد `connect` مجدد Socket.IO):

```
Client → RECONNECT { userId (از access token), lastKnownRoomId }
Server → بررسی RoomMember فعال → SYNC کامل (state فیلترشده + stateVersion + رویدادهای اخیر در صورت نیاز)
```

این یعنی کلاینت هرگز مجبور نیست خودش state را «حدس بزند»؛ همیشه از سرور SYNC می‌گیرد.

---

## ۹. تایمرها (بدون تغییر، تثبیت‌شده)

- سرور `phaseEndsAt` (epoch ms) را در هر `PHASE_STARTED` broadcast می‌کند.
- کلاینت فقط `Math.max(0, phaseEndsAt - now)` را رندر می‌کند.
- پایان فاز، اعتبار رأی، و اجازه‌ی اکشن **همیشه** توسط سرور تصمیم‌گیری می‌شود؛ کلاینت هرگز تصمیم‌گیرنده نیست.

### ۹.۱ Phase Scheduler عمومی (Milestone 7B)

- هر بازی می‌تواند به‌صورت اختیاری `getPhaseEndsAt(state)` را پیاده کند. `PhaseScheduler` در `packages/game-engine/src/scheduler.ts` (بدون هیچ ارجاعی به بازی خاص) وقتی زمان فاز رسید `getNextPhase(state)` را اجرا می‌کند.
- نوشتن state همیشه با **CAS روی `stateVersion`** است (`casApplyPhaseTransition`، یک `UPDATE ... WHERE "stateVersion" = $expected`). تایمر دوبار، تایمر هم‌زمان با اکشن، یا تایمر هم‌زمان با خروج بازیکن → فقط یک انتقال، نسخه فقط ۱ واحد جلو می‌رود و events یک‌بار ذخیره می‌شوند.
- بازیابی بعد از ری‌استارت: `createServer()` → `scheduler.recoverAll()`؛ فازهای منقضی فوراً جلو می‌روند.
- تکمیل زودهنگام (مثلاً همه‌ی نقش‌های شب اکشن داده‌اند) از همان مسیر است: بازی `phaseEndsAt` را به «اکنون» می‌آورد و scheduler بلافاصله جلو می‌برد.
- هر انتقال (اکشن، تایمر، خروج، شروع) فقط از مسیر `broadcastGameTransition` پخش می‌شود: `GAME_EVENT` عمومی برای اتاق + `GAME_STATE` شخصی برای هر سوکت.
- هوک‌های اختیاری دیگر: `onPlayerLeft` (فقط خروج دائمی)، `canSendMessage` (چت)، `acceptsStaleClientVersion` (برای بازی‌هایی با اکشن هم‌زمان چند بازیکن).
- وقتی `checkWinCondition` نتیجه دارد، session `endedAt` می‌گیرد (چت دوباره آزاد می‌شود).

---

## ۱۰. ساختار پوشه‌ها (به‌روزشده)

```
/apps
  /web
  /server
/packages
  /game-engine        → applyAction, validateAction, event bus, sync logic
  /games
    /fake-game         → بازی ساختگی برای تست Engine
    /mafia             → اولین بازی واقعی (M7B) — docs/MAFIA_SPEC.md
    /spy
    /name-family
  /core
    /auth              → providers (guest, phone, email, google, apple)
    /room               → Room, RoomMember, permissions
    /chat
    /presence
  /ui
  /types               → GameDefinition, DomainEvent, ActionEnvelope
  /i18n
/prisma
/tests
  /game-engine          → تست عمومی نشت اطلاعات (بخش ۷) اینجاست
```

---

## ۱۱. نقشه‌ی راه فاز ۱ (به‌روزشده)

1. Auth: guest provider + کوکی HttpOnly + access/refresh token
2. Redis: session store + presence + rate-limit (بدون Socket.IO adapter)
3. Room/RoomMember (با role از روز اول، حتی اگر فقط HOST/PLAYER استفاده شود) + visibility=PRIVATE
4. Game Engine: contract + event bus + `GameEvent` persistence + تست عمومی نشت اطلاعات
5. Reconnection: actionId dedup + stateVersion + SYNC endpoint
6. Lobby UI + چت + تایمر server-authoritative
7. یک `GameDefinition` placeholder ساختگی (نه مافیای واقعی) صرفاً برای تست این‌که Registry/Engine/Reconnection/Leak-test همه با یک بازی «ساختگی» درست کار می‌کنند، پیش از شروع فاز ۲ (مافیای واقعی)

---

## جمع‌بندی

با این تغییرات: هویت مهمان دیگر secret حساس در کلاینت ندارد، Redis فقط برای چیزهایی که واقعاً امروز لازم است به کار می‌رود، Engine رویداد-محور است و پایه‌ی history/replay/spectator/analytics را می‌گذارد بدون پیاده‌سازی زودهنگام، عضویت اتاق و ویزیبیلیتی اتاق برای نقش‌ها و اتاق عمومی/matchmaking آینده باز هستند، و امنیت نشت اطلاعات با یک تست ساختاری در سطح Engine (نه به‌صورت دستی برای هر بازی) تضمین می‌شود.

منتظر تأیید شما هستم تا فاز ۱ را طبق نقشه‌ی راه بالا شروع کنم.
