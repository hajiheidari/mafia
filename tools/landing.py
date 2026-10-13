#!/usr/bin/env python3
"""Generates the Mafia landing pages for espadna.com/mafia-app/.

    python3 tools/landing.py

Writes web/landing/mafia-app/{index.html, fa/, ar/, ru/} and the
privacy pages from one template and the texts below (English at the root,
Persian in fa/, Arabic in ar/, like every espadna.com app, plus Russian in
ru/). Edit the texts here, never the generated HTML.
"""
import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'landing' / 'mafia-app'
SITE = 'https://espadna.com'
BASE = '/mafia-app/'
APP_URL = 'https://mafia.espadna.com'

LANGS = {
    'en': {'dir': 'ltr', 'path': BASE, 'locale': 'en_US', 'label': 'English'},
    'fa': {'dir': 'rtl', 'path': BASE + 'fa/', 'locale': 'fa_IR', 'label': 'فارسی'},
    'ar': {'dir': 'rtl', 'path': BASE + 'ar/', 'locale': 'ar_AR', 'label': 'العربية'},
    'ru': {'dir': 'ltr', 'path': BASE + 'ru/', 'locale': 'ru_RU', 'label': 'Русский'},
}

ROLES = ['godfather', 'lecter', 'mafia', 'doctor', 'detective', 'sniper', 'diehard', 'citizen']
ROLE_ICON = {'godfather': '🎩', 'lecter': '💉', 'mafia': '🔪', 'doctor': '🩺', 'detective': '🔎',
             'sniper': '🎯', 'diehard': '🛡️', 'citizen': '🏠'}
MAFIA_TEAM = {'godfather', 'lecter', 'mafia'}

T = {
    'fa': {
        'title': 'گاد مافیا | ابزار رایگان گرداننده‌ی بازی مافیا',
        'desc': 'ابزار رایگان گرداننده‌ی بازی مافیا: پخش تصادفی نقش با یک گوشی، مدیریت شب و روز، تایمر صحبت و شمارش رأی. بدون نصب، حتی بدون اینترنت.',
        'brand': 'گاد مافیا', 'by': 'از اسپادنا',
        'nav': ['چطور کار می‌کند', 'نقش‌ها', 'یک دور بازی', 'سؤالات'],
        'start': 'شروع بازی', 'how_btn': 'چطور کار می‌کند؟',
        'eyebrow': 'رایگان · بدون نصب · بدون اینترنت',
        'h1': 'مافیای دورهمی را با <span class="red">یک گوشی</span> بگردان',
        'lead': 'دیگر کاغذ و قلم لازم نیست. اسم بازیکن‌ها را وارد کن، نقش‌ها را تصادفی پخش کن تا هر کس روی گوشی نقش خودش را ببیند، و شب و روز را قدم‌به‌قدم با تایمر و شمارش رأی جلو ببر.',
        'stats': [('۸', 'نقش'), ('۴ تا ۳۰', 'بازیکن'), ('۱', 'گوشی کافی است')],
        'how_h': 'چطور کار می‌کند؟', 'how_sub': 'گرداننده فقط یک گوشی لازم دارد.',
        'steps': [('اسم‌ها و نقش‌ها', 'اسم بازیکن‌ها را وارد کن. ابزار بر اساس تعداد، ترکیب نقش‌ها را پیشنهاد می‌دهد و می‌توانی تغییرش بدهی.'),
                  ('پخش مخفی نقش', 'گوشی دست‌به‌دست می‌شود؛ هر کس روی اسم خودش می‌زند، نقشش را می‌بیند و مخفی می‌کند. پخش کاملاً تصادفی است.'),
                  ('گرداندن بازی', 'شب‌ها ابزار به ترتیب می‌گوید چه کسی بیدار شود، انتخاب‌ها را ثبت می‌کند و صبح نتیجه را برای اعلام آماده می‌کند.')],
        'roles_h': 'نقش‌ها', 'roles_sub': 'هر نقش را می‌توانی اضافه یا حذف کنی.',
        'team_mafia': 'تیم مافیا', 'team_town': 'تیم شهر',
        'roles': {
            'godfather': ('پدرخوانده', 'رئیس مافیا. تصمیم شلیک شب با اوست و استعلام کارآگاه از او منفی است.'),
            'lecter': ('دکتر لکتر', 'هر شب یک عضو مافیا را از تیر اسنایپر نجات می‌دهد.'),
            'mafia': ('مافیای ساده', 'شب‌ها با هم‌تیمی‌ها بیدار می‌شود و روزها خودش را بی‌گناه نشان می‌دهد.'),
            'doctor': ('دکتر', 'هر شب یک نفر را نجات می‌دهد؛ خودش را یک بار، و یک نفر را نه دو شب پشت‌سرهم.'),
            'detective': ('کارآگاه', 'هر شب از یک نفر استعلام می‌گیرد. ابزار جواب را به گرداننده نشان می‌دهد.'),
            'sniper': ('اسنایپر', 'شب شلیک می‌کند؛ اگر به شهروند بزند، خودش حذف می‌شود.'),
            'diehard': ('رویین‌تن', 'اولین تیر شب مافیا به او اثر نمی‌کند.'),
            'citizen': ('شهروند ساده', 'توانایی شبانه ندارد؛ قدرت اصلی شهر در بحث و رأی است.'),
        },
        'cycle_h': 'یک دور بازی', 'cycle_sub': 'ابزار هر مرحله را برای گرداننده ساده می‌کند.',
        'cycle': [('day', '💬', 'روز', 'تایمر صحبت با زمان‌های ۳۰ تا ۱۲۰ ثانیه، با هشدار صوتی و لرزش.'),
                  ('day', '🗳️', 'رأی‌گیری', 'شمارش رأی هر بازیکن و نمایش حد نصاب؛ با یک دکمه از بازی خارج می‌شود.'),
                  ('night', '🌙', 'شب', 'بیدار کردن نقش‌ها به ترتیب و ثبت انتخاب هر کدام؛ جواب کارآگاه فوری.'),
                  ('day', '☀️', 'صبح', 'متن اعلام صبح آماده است؛ یادداشت‌های مخفی فقط برای گرداننده.')],
        'feat_h': 'چرا این ابزار؟', 'feat_sub': 'برای دورهمی‌ها ساخته شده.',
        'features': [('📴', 'بدون اینترنت', 'یک بار که باز شود، بدون اینترنت هم کار می‌کند. به صفحه‌ی اصلی گوشی هم اضافه می‌شود.'),
                     ('🎲', 'پخش واقعاً تصادفی', 'بدون تقلب و بدون کاغذ تاخورده؛ هیچ‌کس جز صاحب نقش آن را نمی‌بیند.'),
                     ('🏷️', 'اپ مال گروه شما', 'اسم و لوگوی گروهتان بالای صفحه و پشت کارت نقش‌ها می‌آید، با رنگ دلخواه.'),
                     ('📚', 'سناریوهای آماده و شخصی', 'سناریوهای معروف آماده‌اند؛ نقش و سناریوی خودتان را هم یک بار بسازید و ذخیره کنید.'),
                     ('🧮', 'نتیجه‌ی شب خودکار', 'نجات دکتر، سپر رویین‌تن و تیر اسنایپر خودکار حساب می‌شود.'),
                     ('↶', 'برگشت اشتباه', 'اشتباه کردی؟ آخرین کار را برگردان یا بازیکن را دستی حذف و برگردان.'),
                     ('💾', 'بازی گم نمی‌شود', 'اگر صفحه بسته شد، بازی دقیقاً از همان‌جا ادامه پیدا می‌کند.'),
                     ('🏆', 'تشخیص برنده', 'به‌محض تمام شدن بازی، برنده و نقش همه نمایش داده می‌شود.')],
        'faq_h': 'سؤالات پرتکرار',
        'faq': [('رایگان است؟ نصب لازم دارد؟', 'بله رایگان است و نصب لازم ندارد. در مرورگر گوشی باز کنید؛ اگر خواستید از منوی مرورگر «افزودن به صفحه‌ی اصلی» را بزنید.'),
                ('هر بازیکن گوشی جدا لازم دارد؟', 'نه. فقط گوشی گرداننده لازم است؛ برای دیدن نقش‌ها گوشی دست‌به‌دست می‌شود.'),
                ('اطلاعات بازی جایی ارسال می‌شود؟', 'نه. همه‌چیز فقط روی همان گوشی ذخیره می‌شود و به هیچ سروری فرستاده نمی‌شود.'),
                ('قوانین با قوانین ما فرق دارد، چه کنم؟', 'نقش‌های خودتان را بسازید و ترکیبتان را به‌عنوان سناریو ذخیره کنید. ترکیب نقش‌ها همیشه قابل تغییر است و گرداننده هر وقت بخواهد می‌تواند بازیکنی را دستی حذف یا به بازی برگرداند.')],
        'final_h': 'شب اول نزدیک است', 'final_sub': 'دوستانت را جمع کن و بازی را شروع کن.',
        'footer': 'بخشی از <a href="/fa/">اسپادنا</a>', 'privacy': 'حریم خصوصی', 'home': '/fa/',
        'og_title': 'گاد مافیا 🕵️ مافیای دورهمی را با یک گوشی بگردان',
        'note': '',
    },
    'en': {
        'title': 'Mafia God: Party Narrator | Free host tool for the Mafia game',
        'desc': 'Free narrator tool for the Mafia (Werewolf) party game: deal secret roles on one phone, run night and day, talk timer and vote counter. No install, works offline.',
        'brand': 'Mafia God', 'by': 'by Espadna',
        'nav': ['How it works', 'Roles', 'A round', 'FAQ'],
        'start': 'Start a game', 'how_btn': 'How does it work?',
        'eyebrow': 'Free · No install · Works offline',
        'h1': 'Host your Mafia night with <span class="red">one phone</span>',
        'lead': 'No more paper slips. Type the players’ names, deal the roles at random so everyone sees only their own on the phone, and run every night and day step by step with a talk timer and a vote counter.',
        'stats': [('8', 'roles'), ('4–30', 'players'), ('1', 'phone is enough')],
        'how_h': 'How does it work?', 'how_sub': 'The narrator needs just one phone.',
        'steps': [('Names and roles', 'Enter the players. The tool suggests a role mix for that many people, and you can change it.'),
                  ('Secret role deal', 'Pass the phone around: each player taps their name, sees their role and hides it. The deal is truly random.'),
                  ('Run the game', 'At night the tool tells you whom to wake, in order, records each choice and has the morning announcement ready.')],
        'roles_h': 'Roles', 'roles_sub': 'Add or remove any role.',
        'team_mafia': 'Mafia', 'team_town': 'Town',
        'roles': {
            'godfather': ('Godfather', 'Leads the mafia. Decides the night shot and reads as innocent to the detective.'),
            'lecter': ('Dr. Lecter', 'The mafia’s doctor: each night saves one mafia member from the sniper.'),
            'mafia': ('Mafia', 'Wakes with the team at night and acts innocent by day.'),
            'doctor': ('Doctor', 'Saves one player each night; themself only once, and never the same player two nights in a row.'),
            'detective': ('Detective', 'Investigates one player each night; the tool shows the narrator the answer.'),
            'sniper': ('Sniper', 'Can shoot at night; hitting a townsperson costs the sniper their own life.'),
            'diehard': ('Die Hard', 'Survives the first mafia shot.'),
            'citizen': ('Citizen', 'No night power; the town’s real strength is talking and voting.'),
        },
        'cycle_h': 'A round of play', 'cycle_sub': 'Every step made simple for the narrator.',
        'cycle': [('day', '💬', 'Day', 'Talk timer from 30 to 120 seconds, with a sound and vibration at the end.'),
                  ('day', '🗳️', 'Vote', 'Count each player’s votes against the majority line; one tap sends them out.'),
                  ('night', '🌙', 'Night', 'Wake each role in order and record its choice; the detective’s answer shows instantly.'),
                  ('day', '☀️', 'Morning', 'The announcement is ready to read out; secret notes are for the narrator only.')],
        'feat_h': 'Why this tool?', 'feat_sub': 'Made for game nights.',
        'features': [('📴', 'Works offline', 'After the first visit it works without internet, and installs to the home screen.'),
                     ('🎲', 'Truly random', 'No cheating, no folded paper: nobody but the owner ever sees a role.'),
                     ('🏷️', 'Your group’s own app', 'Your group’s name and logo on every screen and on the back of the role cards, in your colour.'),
                     ('📚', 'Ready and saved scenarios', 'Popular scenarios are built in; make your own roles and setups once and keep them.'),
                     ('🧮', 'Automatic night result', 'Doctor saves, the Die Hard’s shield and sniper shots are worked out for you.'),
                     ('↶', 'Undo mistakes', 'Undo the last step, or remove and bring back a player by hand.'),
                     ('💾', 'Never lose a game', 'Close the page by accident and the game picks up exactly where it was.'),
                     ('🏆', 'Winner detection', 'The moment a side wins, the result and everyone’s role are shown.')],
        'faq_h': 'FAQ',
        'faq': [('Is it free? Do I install anything?', 'It is free and needs no install. Open it in the phone’s browser, and if you like use “Add to Home Screen”.'),
                ('Does every player need a phone?', 'No. Only the narrator’s phone; it is passed around for the role deal.'),
                ('Is any game data sent anywhere?', 'No. Everything stays on that one phone and is never sent to a server.'),
                ('Which language is the tool in?', 'The app speaks English, Persian, Arabic and Russian, and follows your phone’s language.'),
                ('Our house rules are different. What now?', 'Pick any role mix, and the narrator can remove or bring back a player by hand at any time.')],
        'final_h': 'The first night is coming', 'final_sub': 'Gather your friends and start.',
        'footer': 'Part of <a href="/">Espadna</a>', 'privacy': 'Privacy', 'home': '/',
        'og_title': 'Mafia God 🕵️ Host your Mafia night with one phone',
        'note': '',
    },
    'ar': {
        'title': 'Mafia God | أداة مجانية لراوي لعبة المافيا',
        'desc': 'أداة مجانية لراوي لعبة المافيا: توزيع الأدوار سرًا على هاتف واحد، إدارة الليل والنهار، مؤقت للكلام وعدّاد للتصويت. دون تثبيت، وتعمل دون إنترنت.',
        'brand': 'Mafia God', 'by': 'من إسبادنا',
        'nav': ['كيف تعمل', 'الأدوار', 'جولة اللعب', 'الأسئلة'],
        'start': 'ابدأ اللعب', 'how_btn': 'كيف تعمل؟',
        'eyebrow': 'مجانية · دون تثبيت · دون إنترنت',
        'h1': 'أدِر سهرة المافيا <span class="red">بهاتف واحد</span>',
        'lead': 'لا حاجة إلى الورق بعد الآن. أدخل أسماء اللاعبين، وزّع الأدوار عشوائيًا ليرى كل لاعب دوره فقط على الهاتف، وأدِر الليل والنهار خطوة بخطوة مع مؤقت للكلام وعدّاد للأصوات.',
        'stats': [('٨', 'أدوار'), ('٤ إلى ٣٠', 'لاعبًا'), ('١', 'هاتف يكفي')],
        'how_h': 'كيف تعمل؟', 'how_sub': 'يحتاج الراوي إلى هاتف واحد فقط.',
        'steps': [('الأسماء والأدوار', 'أدخل أسماء اللاعبين، فتقترح الأداة توزيعة أدوار تناسب عددهم ويمكنك تعديلها.'),
                  ('توزيع سري للأدوار', 'يُمرَّر الهاتف بين اللاعبين؛ يضغط كل لاعب على اسمه ويرى دوره ثم يخفيه. التوزيع عشوائي تمامًا.'),
                  ('إدارة اللعبة', 'في الليل تخبرك الأداة بمن يستيقظ بالترتيب، وتسجّل كل اختيار، وتجهّز إعلان الصباح.')],
        'roles_h': 'الأدوار', 'roles_sub': 'يمكنك إضافة أي دور أو حذفه.',
        'team_mafia': 'فريق المافيا', 'team_town': 'فريق المدينة',
        'roles': {
            'godfather': ('العرّاب', 'زعيم المافيا. يقرّر طلقة الليل ويظهر بريئًا عند تحقيق المحقق.'),
            'lecter': ('الدكتور ليكتر', 'طبيب المافيا: ينقذ كل ليلة عضوًا من المافيا من رصاصة القنّاص.'),
            'mafia': ('مافيا', 'يستيقظ مع فريقه ليلًا ويتظاهر بالبراءة نهارًا.'),
            'doctor': ('الطبيب', 'ينقذ لاعبًا كل ليلة؛ نفسه مرة واحدة فقط، ولا ينقذ اللاعب نفسه ليلتين متتاليتين.'),
            'detective': ('المحقق', 'يحقق كل ليلة مع لاعب، وتعرض الأداة الجواب على الراوي.'),
            'sniper': ('القنّاص', 'يطلق النار ليلًا؛ وإن أصاب مواطنًا يخرج هو من اللعبة.'),
            'diehard': ('الصامد', 'لا تؤثر فيه أول طلقة من المافيا.'),
            'citizen': ('مواطن', 'لا قدرة ليلية له؛ قوة المدينة الحقيقية في النقاش والتصويت.'),
        },
        'cycle_h': 'جولة اللعب', 'cycle_sub': 'كل مرحلة أسهل على الراوي.',
        'cycle': [('day', '💬', 'النهار', 'مؤقت للكلام من ٣٠ إلى ١٢٠ ثانية مع صوت واهتزاز عند النهاية.'),
                  ('day', '🗳️', 'التصويت', 'عدّ أصوات كل لاعب مع إظهار حدّ الأغلبية، وإخراجه بضغطة واحدة.'),
                  ('night', '🌙', 'الليل', 'إيقاظ الأدوار بالترتيب وتسجيل اختياراتها، وجواب المحقق فوري.'),
                  ('day', '☀️', 'الصباح', 'نص إعلان الصباح جاهز للقراءة، والملاحظات السرية للراوي فقط.')],
        'feat_h': 'لماذا هذه الأداة؟', 'feat_sub': 'صُممت لسهرات الأصدقاء.',
        'features': [('📴', 'دون إنترنت', 'بعد أول فتح تعمل دون إنترنت، ويمكن إضافتها إلى الشاشة الرئيسية.'),
                     ('🎲', 'عشوائية حقيقية', 'لا غش ولا أوراق مطوية؛ لا يرى الدور إلا صاحبه.'),
                     ('🏷️', 'تطبيق مجموعتكم', 'اسم مجموعتكم وشعارها في أعلى الشاشة وعلى ظهر بطاقات الأدوار، باللون الذي تختارونه.'),
                     ('📚', 'سيناريوهات جاهزة ومحفوظة', 'السيناريوهات المشهورة جاهزة، وأنشئوا أدواركم وتشكيلاتكم مرة واحدة واحفظوها.'),
                     ('🧮', 'نتيجة الليل تلقائيًا', 'إنقاذ الطبيب ودرع الصامد ورصاصة القنّاص تُحسب تلقائيًا.'),
                     ('↶', 'تراجع عن الخطأ', 'تراجع عن الخطوة الأخيرة أو أخرج لاعبًا وأعده يدويًا.'),
                     ('💾', 'لا تضيع اللعبة', 'إن أُغلقت الصفحة، تستمر اللعبة من حيث توقفت تمامًا.'),
                     ('🏆', 'تحديد الفائز', 'فور فوز أحد الفريقين تظهر النتيجة ودور كل لاعب.')],
        'faq_h': 'الأسئلة الشائعة',
        'faq': [('هل هي مجانية؟ هل تحتاج إلى تثبيت؟', 'مجانية ولا تحتاج إلى تثبيت. افتحها في متصفح الهاتف، وإن شئت اختر «إضافة إلى الشاشة الرئيسية».'),
                ('هل يحتاج كل لاعب إلى هاتف؟', 'لا. يكفي هاتف الراوي، ويُمرَّر بين اللاعبين لرؤية الأدوار.'),
                ('هل تُرسل بيانات اللعبة إلى أي مكان؟', 'لا. كل شيء يبقى على ذلك الهاتف ولا يُرسل إلى أي خادم.'),
                ('ما لغة الأداة؟', 'التطبيق متوفر بالعربية والإنجليزية والفارسية والروسية، ويتبع لغة هاتفك.'),
                ('قواعدنا مختلفة، ماذا نفعل؟', 'اختر أي توزيعة أدوار، ويمكن للراوي إخراج لاعب أو إعادته يدويًا في أي وقت.')],
        'final_h': 'الليلة الأولى تقترب', 'final_sub': 'اجمع أصدقاءك وابدأ اللعب.',
        'footer': 'جزء من <a href="/ar/">إسبادنا</a>', 'privacy': 'الخصوصية', 'home': '/ar/',
        'og_title': 'Mafia God 🕵️ أدِر سهرة المافيا بهاتف واحد',
        'note': '',
    },
}

PRIVACY = {
    'en': ('Privacy policy · Mafia God', 'Privacy policy', [
        ('What we collect', 'Mafia God has no accounts, no ads, no analytics and no tracking. Nothing leaves your device unless you use one of the optional services below.'),
        ('Your game data', 'Player names, roles and game progress are stored only on your device (in the browser or app storage) so a game can continue after the page is closed. They are never sent to us or to anyone else. Clearing the app data or browser data deletes them.'),
        ('Permissions', 'The app asks for no permissions. Vibration is used only for the talk timer.'),
        ('Children', 'The app collects no personal information from anyone, including children.'),
        ('Recovery code (optional)', 'If you create a recovery code, your roles, scenarios, group name and logo are encrypted on your device with a key made from that code and stored on our server (Cloudflare) so you can restore them on another phone. The code itself never leaves your device, so we cannot read the backup. It is deleted 400 days after the last save.'),
        ('iCloud, Google and Game Center', 'On iPhone and iPad the same data is also kept in your own iCloud. On Android it is included in the phone’s Google backup if you have that turned on. If you sign in to Game Center, Apple receives the number of games you host and the medals you earn, for the leaderboards and your profile. These services are run by Apple and Google under their own privacy policies.'),
        ('Contact', 'Questions: <a href="mailto:sepanta.hesaban@gmail.com">sepanta.hesaban@gmail.com</a>'),
    ]),
    'fa': ('حریم خصوصی · گاد مافیا', 'سیاست حریم خصوصی', [
        ('چه اطلاعاتی جمع می‌کنیم', 'گاد مافیا حساب کاربری، تبلیغ، آمارگیری و ردیابی ندارد. هیچ اطلاعاتی از دستگاه شما بیرون نمی‌رود مگر اینکه یکی از سرویس‌های اختیاری زیر را خودتان روشن کنید.'),
        ('اطلاعات بازی شما', 'اسم بازیکن‌ها، نقش‌ها و وضعیت بازی فقط روی همان دستگاه (حافظه‌ی مرورگر یا اپ) ذخیره می‌شود تا اگر صفحه بسته شد بازی ادامه پیدا کند. این اطلاعات هرگز برای ما یا هیچ‌کس دیگری فرستاده نمی‌شود و با پاک کردن داده‌های اپ یا مرورگر پاک می‌شود.'),
        ('مجوزها', 'اپ هیچ مجوزی نمی‌خواهد. لرزش فقط برای تایمر صحبت استفاده می‌شود.'),
        ('کودکان', 'اپ از هیچ‌کس، از جمله کودکان، اطلاعات شخصی جمع نمی‌کند.'),
        ('کد بازیابی (اختیاری)', 'اگر کد بازیابی بسازید، نقش\u200cها، سناریوها و اسم و لوگوی گروه روی همان دستگاه با کلیدی که از همان کد ساخته می\u200cشود رمزگذاری و روی سرور ما (Cloudflare) نگه داشته می\u200cشوند تا روی گوشی دیگری برگردانده شوند. خود کد هرگز از دستگاه شما بیرون نمی\u200cرود، پس ما نمی\u200cتوانیم پشتیبان را بخوانیم. پشتیبان ۴۰۰ روز بعد از آخرین ذخیره پاک می\u200cشود.'),
        ('iCloud، گوگل و گیم سنتر', 'روی آیفون و آیپد همین اطلاعات در iCloud خودتان هم نگه داشته می\u200cشود. روی اندروید اگر پشتیبان\u200cگیری گوگل گوشی روشن باشد، جزو آن است. اگر وارد گیم سنتر شوید، اپل تعداد بازی\u200cهایی که می\u200cگردانید و مدال\u200cهایتان را برای رتبه\u200cبندی و پروفایل شما دریافت می\u200cکند. این سرویس\u200cها را اپل و گوگل با سیاست حریم خصوصی خودشان اداره می\u200cکنند.'),
        ('تماس', 'سؤال‌ها: <a href="mailto:sepanta.hesaban@gmail.com">sepanta.hesaban@gmail.com</a>'),
    ]),
    'ar': ('الخصوصية · Mafia God', 'سياسة الخصوصية', [
        ('ما الذي نجمعه', 'لا يحتوي Mafia God على حسابات أو إعلانات أو إحصاءات أو تتبّع. لا يغادر شيء جهازك إلا إذا استخدمت إحدى الخدمات الاختيارية أدناه.'),
        ('بيانات لعبتك', 'تُحفظ أسماء اللاعبين والأدوار وحالة اللعبة على جهازك فقط (في ذاكرة المتصفح أو التطبيق) لتستمر اللعبة بعد إغلاق الصفحة. لا تُرسل إلينا أو إلى أي جهة أخرى أبدًا، وتُحذف بحذف بيانات التطبيق أو المتصفح.'),
        ('الأذونات', 'لا يطلب التطبيق أي إذن. يُستخدم الاهتزاز لمؤقت الكلام فقط.'),
        ('الأطفال', 'لا يجمع التطبيق أي معلومات شخصية من أي أحد، بمن فيهم الأطفال.'),
        ('رمز الاستعادة (اختياري)', 'إذا أنشأت رمز استعادة، تُشفَّر أدوارك وسيناريوهاتك واسم مجموعتك وشعارها على جهازك بمفتاح مشتق من هذا الرمز وتُحفظ على خادمنا (Cloudflare) لتتمكن من استعادتها على هاتف آخر. لا يغادر الرمز جهازك أبدًا، لذا لا نستطيع قراءة النسخة الاحتياطية. تُحذف بعد ٤٠٠ يوم من آخر حفظ.'),
        ('iCloud وGoogle وGame Center', 'على iPhone وiPad تُحفظ البيانات نفسها في حساب iCloud الخاص بك أيضًا. على Android تُضمَّن في النسخ الاحتياطي من Google إذا كان مفعّلًا. إذا سجّلت الدخول إلى Game Center، تتلقى Apple عدد الألعاب التي تديرها والميداليات التي تحصل عليها، للترتيب وملفك الشخصي. تدير Apple وGoogle هذه الخدمات وفق سياسات الخصوصية الخاصة بهما.'),
        ('التواصل', 'للأسئلة: <a href="mailto:sepanta.hesaban@gmail.com">sepanta.hesaban@gmail.com</a>'),
    ]),
}
UPDATED = {'en': 'Last updated: 13 October 2026', 'fa': 'آخرین به‌روزرسانی: ۲۱ مهر ۱۴۰۵', 'ar': 'آخر تحديث: ١٣ أكتوبر ٢٠٢٦'}

# --- Russian ---

T_RU = {
    'title': 'Mafia God: ведущий для игры в мафию | Бесплатный помощник ведущего',
    'desc': 'Бесплатный помощник ведущего для игры в мафию: тайная раздача ролей с одного телефона, ночь и день по шагам, таймер речи и подсчёт голосов. Без установки, работает офлайн.',
    'brand': 'Mafia God', 'by': 'от Espadna',
    'nav': ['Как это работает', 'Роли', 'Ход игры', 'Вопросы'],
    'start': 'Начать игру', 'how_btn': 'Как это работает?',
    'eyebrow': 'Бесплатно · Без установки · Без интернета',
    'h1': 'Ведите мафию с <span class="red">одного телефона</span>',
    'lead': 'Больше никаких бумажек. Введите имена игроков, раздайте роли случайно — каждый увидит на телефоне только свою, — и ведите каждую ночь и каждый день по шагам, с таймером речи и подсчётом голосов.',
    'stats': [('8', 'ролей'), ('4–30', 'игроков'), ('1', 'телефона хватит')],
    'how_h': 'Как это работает?', 'how_sub': 'Ведущему нужен всего один телефон.',
    'steps': [('Имена и роли', 'Введите игроков. Приложение предложит набор ролей под их число, а вы можете его изменить.'),
              ('Тайная раздача', 'Передавайте телефон по кругу: каждый нажимает на своё имя, смотрит роль и скрывает её. Раздача по-настоящему случайна.'),
              ('Ведение игры', 'Ночью приложение подсказывает, кого будить и в каком порядке, записывает каждый выбор и готовит утреннее объявление.')],
    'roles_h': 'Роли', 'roles_sub': 'Любую роль можно добавить или убрать.',
    'team_mafia': 'Мафия', 'team_town': 'Мирные',
    'roles': {
        'godfather': ('Крёстный отец', 'Глава мафии. Решает, в кого стрелять ночью, а Детектив видит его как «не мафию».'),
        'lecter': ('Доктор Лектер', 'Доктор мафии: каждую ночь спасает одного из мафии от выстрела Снайпера.'),
        'mafia': ('Мафия', 'Ночью просыпается вместе с командой, а днём притворяется мирным.'),
        'doctor': ('Доктор', 'Каждую ночь лечит одного игрока; себя — только один раз и не одного и того же две ночи подряд.'),
        'detective': ('Детектив', 'Каждую ночь проверяет одного игрока; приложение показывает ответ ведущему.'),
        'sniper': ('Снайпер', 'Может стрелять ночью; попав в мирного, выбывает сам.'),
        'diehard': ('Неуязвимый', 'Переживает первый выстрел мафии.'),
        'citizen': ('Мирный житель', 'Ночных способностей нет; настоящая сила города — в обсуждении и голосовании.'),
    },
    'cycle_h': 'Ход игры', 'cycle_sub': 'Каждый шаг — проще для ведущего.',
    'cycle': [('day', '💬', 'День', 'Таймер речи от 30 до 120 секунд, со звуком и вибрацией в конце.'),
              ('day', '🗳️', 'Голосование', 'Подсчёт голосов за каждого игрока с порогом большинства; одно нажатие — и игрок выбывает.'),
              ('night', '🌙', 'Ночь', 'Будите роли по очереди и записывайте их выбор; ответ Детективу виден сразу.'),
              ('day', '☀️', 'Утро', 'Объявление готово, его остаётся прочитать вслух; тайные заметки — только для ведущего.')],
    'feat_h': 'Почему это приложение?', 'feat_sub': 'Сделано для игровых вечеров.',
    'features': [('📴', 'Работает офлайн', 'После первого открытия работает без интернета и ставится на главный экран.'),
                 ('🎲', 'Честный случай', 'Никаких подглядываний и сложенных бумажек: роль видит только её владелец.'),
                 ('🏷️', 'Приложение вашего клуба', 'Название и логотип клуба на каждом экране и на рубашке карт ролей — в ваших цветах.'),
                 ('📚', 'Готовые и свои сценарии', 'Популярные сценарии уже встроены; свои роли и наборы создайте один раз и сохраните.'),
                 ('🧮', 'Итоги ночи сами собой', 'Лечение Доктора, защита Неуязвимого и выстрелы Снайпера просчитываются автоматически.'),
                 ('↶', 'Отмена ошибок', 'Отмените последний шаг или вручную уберите и верните игрока.'),
                 ('💾', 'Игра не потеряется', 'Случайно закрыли страницу — игра продолжится ровно с того же места.'),
                 ('🏆', 'Определение победителя', 'Как только одна из сторон побеждает, сразу видны итог и роли всех игроков.')],
    'faq_h': 'Вопросы',
    'faq': [('Это бесплатно? Нужно что-то устанавливать?', 'Бесплатно и без установки. Откройте в браузере телефона и, если хотите, выберите «На экран „Домой“».'),
            ('Нужен ли телефон каждому игроку?', 'Нет. Только телефон ведущего; для раздачи ролей его передают по кругу.'),
            ('Данные игры куда-нибудь отправляются?', 'Нет. Всё остаётся на этом телефоне и никогда не отправляется на сервер.'),
            ('На каком языке приложение?', 'Приложение говорит по-русски, по-английски, на фарси и по-арабски.'),
            ('У нас свои правила. Что делать?', 'Соберите любой набор ролей, а ведущий может в любой момент вручную убрать или вернуть игрока.')],
    'final_h': 'Город скоро засыпает', 'final_sub': 'Собирайте друзей и начинайте.',
    'footer': 'Часть <a href="/">Espadna</a>', 'privacy': 'Конфиденциальность', 'home': '/',
    'og_title': 'Mafia God 🕵️ Ведите мафию с одного телефона',
    'note': '',
}

PRIVACY_RU = ('Политика конфиденциальности · Mafia God', 'Политика конфиденциальности', [
    ('Что мы собираем', 'В Mafia God нет аккаунтов, рекламы, аналитики и отслеживания. Ничего не покидает ваше устройство, если вы сами не включите одну из необязательных служб ниже.'),
    ('Данные игры', 'Имена игроков, роли и ход игры хранятся только на вашем устройстве (в хранилище браузера или приложения), чтобы игру можно было продолжить после закрытия страницы. Они никогда не отправляются ни нам, ни кому-либо ещё. Очистка данных приложения или браузера удаляет их.'),
    ('Разрешения', 'Приложение не запрашивает никаких разрешений. Вибрация используется только для таймера речи.'),
    ('Дети', 'Приложение не собирает личную информацию ни о ком, в том числе о детях.'),
    ('Код восстановления (по желанию)', 'Если вы создаёте код восстановления, роли, сценарии, название и логотип клуба шифруются на вашем устройстве ключом из этого кода и хранятся на нашем сервере (Cloudflare), чтобы их можно было вернуть на другом телефоне. Сам код никогда не покидает устройство, поэтому мы не можем прочитать копию. Она удаляется через 400 дней после последнего сохранения.'),
    ('iCloud, Google и Game Center', 'На iPhone и iPad эти же данные хранятся и в вашем iCloud. На Android они входят в резервную копию Google, если она включена. Если вы входите в Game Center, Apple получает число проведённых вами игр и ваши медали — для рейтингов и вашего профиля. Эти сервисы работают по политикам конфиденциальности Apple и Google.'),
    ('Контакты', 'Вопросы: <a href="mailto:sepanta.hesaban@gmail.com">sepanta.hesaban@gmail.com</a>'),
])

UPDATED_RU = 'Обновлено: 13 октября 2026'

T['ru'] = T_RU
PRIVACY['ru'] = PRIVACY_RU
UPDATED['ru'] = UPDATED_RU

e = html.escape


def head(lang: str, title: str, desc: str, path: str, og_title: str, alternates: bool) -> str:
    L = LANGS[lang]
    alt = ''
    if alternates:
        alt = ''.join(f'  <link rel="alternate" hreflang="{k}" href="{SITE}{v["path"]}">\n' for k, v in LANGS.items())
        alt += f'  <link rel="alternate" hreflang="x-default" href="{SITE}{BASE}">\n'
    return f'''<!doctype html>
<html lang="{lang}" dir="{L['dir']}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <meta name="theme-color" content="#0B0B14">
  <link rel="canonical" href="{SITE}{path}">
{alt}  <link rel="icon" type="image/png" href="{BASE}favicon.png">
  <link rel="apple-touch-icon" href="{BASE}icon.png">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="{L['locale']}">
  <meta property="og:site_name" content="Espadna">
  <meta property="og:title" content="{e(og_title)}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{SITE}{path}">
  <meta property="og:image" content="{SITE}{BASE}og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preload" href="{BASE}fonts/vazirmatn-arabic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="{BASE}style.css">
'''


def lang_switch(lang: str, suffix: str = '') -> str:
    """A small 🌐 menu (no script): five languages no longer fit in the header on a phone."""
    links = ''.join(
        f'<a href="{v["path"]}{suffix}" hreflang="{k}" lang="{k}"{" aria-current=\"page\"" if k == lang else ""}>{v["label"]}</a>'
        for k, v in LANGS.items())
    return (f'<details class="langs"><summary aria-label="Language">🌐 {LANGS[lang]["label"]}</summary>'
            f'<nav class="langs-menu" aria-label="Language">{links}</nav></details>')


def page(lang: str) -> str:
    t = T[lang]
    app = f'{APP_URL}/?lang={lang}'
    ld = {
        '@context': 'https://schema.org', '@type': 'WebApplication', 'name': t['brand'],
        'description': t['desc'], 'url': SITE + LANGS[lang]['path'], 'applicationCategory': 'GameApplication',
        'operatingSystem': 'Web, Android, iOS', 'inLanguage': ['en', 'fa', 'ar', 'ru'],
        'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
        'publisher': {'@type': 'Organization', 'name': 'Espadna', 'url': SITE},
    }
    roles = ''.join(
        f'''<article class="card role{' mafia' if r in MAFIA_TEAM else ''}"><div class="icon">{ROLE_ICON[r]}</div>'''
        f'''<span class="team {'team-mafia' if r in MAFIA_TEAM else 'team-town'}">{t['team_mafia'] if r in MAFIA_TEAM else t['team_town']}</span>'''
        f'''<h3>{t['roles'][r][0]}</h3><p>{t['roles'][r][1]}</p></article>\n'''
        for r in ROLES)
    steps = ''.join(f'<div class="card step"><div><h3>{a}</h3><p>{b}</p></div></div>\n' for a, b in t['steps'])
    cycle = ''.join(f'<div class="phase {k}"><div class="t">{i}</div><h3>{a}</h3><p>{b}</p></div>\n' for k, i, a, b in t['cycle'])
    feats = ''.join(f'<div class="card feature"><span class="i">{i}</span><div><h3>{a}</h3><p>{b}</p></div></div>\n' for i, a, b in t['features'])
    faq = ''.join(f'<details><summary>{q}</summary><p>{a}</p></details>\n' for q, a in t['faq'])
    stats = ''.join(f'<div><b>{n}</b>{l}</div>' for n, l in t['stats'])
    note = f'<p class="note">{t["note"]}</p>' if t['note'] else ''
    nav = t['nav']
    return head(lang, t['title'], t['desc'], LANGS[lang]['path'], t['og_title'], True) + f'''  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="{LANGS[lang]['path']}">🕵️ {t['brand']} <small>{t['by']}</small></a>
      <nav class="links" aria-label="{t['brand']}">
        <a href="#how">{nav[0]}</a><a href="#roles">{nav[1]}</a><a href="#rules">{nav[2]}</a><a href="#faq">{nav[3]}</a>
      </nav>
      <div class="top-actions">
        {lang_switch(lang)}
        <a class="btn btn-primary btn-sm" href="{app}">{t['start']}</a>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap">
        <img src="{BASE}icon.png" alt="" width="112" height="112" style="border-radius:26px;margin-bottom:20px">
        <br><span class="eyebrow">{t['eyebrow']}</span>
        <h1>{t['h1']}</h1>
        <p class="lead">{t['lead']}</p>
        <div class="cta">
          <a class="btn btn-primary" href="{app}">{t['start']}</a>
          <a class="btn btn-ghost" href="#how">{t['how_btn']}</a>
        </div>
        {note}
        <div class="stats">{stats}</div>
      </div>
    </section>

    <section id="how"><div class="wrap">
      <h2>{t['how_h']}</h2><p class="sub">{t['how_sub']}</p>
      <div class="grid grid-3 steps">
{steps}      </div>
    </div></section>

    <section id="roles"><div class="wrap">
      <h2>{t['roles_h']}</h2><p class="sub">{t['roles_sub']}</p>
      <div class="grid grid-4">
{roles}      </div>
    </div></section>

    <section id="rules"><div class="wrap">
      <h2>{t['cycle_h']}</h2><p class="sub">{t['cycle_sub']}</p>
      <div class="cycle">
{cycle}      </div>
    </div></section>

    <section><div class="wrap">
      <h2>{t['feat_h']}</h2><p class="sub">{t['feat_sub']}</p>
      <div class="grid grid-3">
{feats}      </div>
    </div></section>

    <section id="faq"><div class="wrap" style="max-width:760px">
      <h2 class="center">{t['faq_h']}</h2><p class="sub center">&nbsp;</p>
{faq}    </div></section>

    <section><div class="wrap"><div class="final">
      <h2>{t['final_h']}</h2><p class="sub">{t['final_sub']}</p>
      <div class="cta"><a class="btn btn-primary" href="{app}">{t['start']}</a></div>
    </div></div></section>
  </main>

  <footer><div class="wrap">{t['footer']} · <a href="{LANGS[lang]['path']}privacy/">{t['privacy']}</a></div></footer>
</body>
</html>
'''


def privacy(lang: str) -> str:
    title, h1, items = PRIVACY[lang]
    path = LANGS[lang]['path'] + 'privacy/'
    body = ''.join(f'<h2>{a}</h2><p>{b}</p>\n' for a, b in items)
    back = T[lang]
    return head(lang, title, title, path, title, False) + f'''</head>
<body>
  <main class="wrap doc">
    <p><a href="{LANGS[lang]['path']}">{'→' if LANGS[lang]['dir'] == 'rtl' else '←'} {back['brand']}</a></p>
    <h1>{h1}</h1>
    <p>{UPDATED[lang]}</p>
{body}  </main>
</body>
</html>
'''


def main() -> None:
    for lang in LANGS:
        out = ROOT / LANGS[lang]['path'][len(BASE):] / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page(lang))
    for lang in PRIVACY:
        out = ROOT / LANGS[lang]['path'][len(BASE):] / 'privacy' / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(privacy(lang))
    print('landing pages written:', ', '.join(LANGS), '+ privacy', ', '.join(PRIVACY))


if __name__ == '__main__':
    main()
