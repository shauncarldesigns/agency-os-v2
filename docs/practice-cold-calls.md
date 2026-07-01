# Practice Cold Calls — Reference

**Purpose:** Single source of truth for how Shaun Carl Designs runs cold calls today. This document mirrors the exact content live in the app's playbook cockpit at [agency-os-v2-dashboard.pages.dev](https://agency-os-v2-dashboard.pages.dev). Written for Claude chat / any assistant that needs to run a practice call and needs to know what's actually in the playbook.

**This file is not parsed by the app.** It's a human/AI-readable snapshot. When the operator edits the runtime playbook files under `agency-os-backend/src/playbook/`, this file should be regenerated to stay in sync.

**Last synced with the runtime playbook:** matches state as of `main` after PR #105.

---

## How the cockpit is organized

When the operator is on a live call, they see three parallel surfaces:

1. **Script panel (left)** — the linear cold-call script. Operator walks through it top-to-bottom. Some stages are marked as "branch" — those don't appear in the linear flow but the operator taps them from the breadcrumb when the prospect says something specific.

2. **Objection panel (right)** — 13 chips grouped into two categories:
   - **Standard** (7 chips) — one-tap simple rebuttals
   - **Deep Dive · branches** (6 chips) — branching rebuttals with a diagnostic question + multiple paths
   
   Operator taps a chip mid-call to fire the matching rebuttal, then returns to the script.

3. **Notes + outcome bar (bottom)** — call notes textarea + four outcome buttons (Voicemail, Not interested, Callback, Booked demo).

After the cold call books a demo, the operator uses one of two **Demo scripts** on the actual demo call.

Three tokens get interpolated at runtime from the lead record: `[Company Name]`, `[Name]`, `[their trade]`. Plus three from enrichment data: `[review_count]`, `[review_avg]`, `[reviews]`.

---

# 1. Cold Call Script — "No-Oriented"

**Method:** Chris Voss tactical empathy — invite "no" responses, use labels + mirrors, never push.

**Breadcrumb order (13 stages, ↗ = branch):**
`Answer · Intro · Terrible time↗ · Not interested↗ · Hook · Busy → Demo↗ · Pushback↗ · Cost↗ · Hesitate↗ · Close 1 · Close 2 · Close 3 · Narrow time↗ · Confirm`

Linear stages (Answer / Intro / Hook / Close 1 / Close 2 / Close 3 / Confirm) are walked via the Advance button. Branch stages (all the ↗ ones) only fire when the operator taps them in response to what the prospect said.

---

## Answer

**Say this:**
> "Hi, is this [Company Name]?"

**Note:** Wait for confirmation. Get their name if possible.

---

## Intro

**Say this:**
> "My name is Shaun — I build websites for local businesses here in Wisconsin and help them get found on Google. Have I caught you at a terrible time?"

**Note:** "Terrible time" invites a No — "No, what's up?" — puts them at ease immediately.

---

## Terrible time ↗ *(branch)*

Tap when the prospect answers "yes, this is a terrible time."

**Say this:**
> "Is there a time that would be less terrible — maybe early morning or later in the week?"

**Note:** Short, no pressure. Hand control back to them.

---

## Not interested ↗ *(branch)*

Tap when the prospect immediately says they're not interested at the Intro stage.

**Say this:**
> "That's completely fair. Is it crazy to just leave you my number in case anything changes down the road?"

**Note:** Almost nobody says no to this. Keeps the door open for a future callback.

---

## Hook

**Say this:**
> "I was looking you guys up on Google and saw some really great reviews but I didn't see a website — So I actually went ahead and put a site together for you just to see what it could look like. I'm not here to pitch you anything — would it be ridiculous to schedule a call so I can just show it to you?"

**Note:** Either answer opens the door: "working on it" = active interest; "not really" = invitation to show what could be there.

**Never argue with a stated fact.** If they say "I have a website," assume your research missed it and pivot to "Oh nice — how are you ranking?" instead of pushing back. Same rule for any factual claim they make.

---

## Busy → Demo ↗ *(branch)*

Tap when they say something like "I'm heading into back-to-back calls" or "can we do this another time."

**Say this:**
> "Totally — and honestly we don't need to do this conversation twice. Let me just send you a calendar invite for a 10-minute demo this week. That way next time we talk it's me showing you the actual site instead of me explaining what it is. What works better — tomorrow morning or end of the day Thursday?"

**Note:** Three plays working at once: (1) "we don't need to do this conversation twice" protects their time; (2) skip the callback, go straight to the demo; (3) closed-ended choice (tomorrow morning vs Thursday afternoon), not "what works for you."

---

## Pushback ↗ *(branch)*

Tap when they push back on "you built me a website."

**Say this:**
> "Honestly? Yeah, I do this for businesses I'd actually want to work with. You didn't really have an online presence, so I used your reviews and business info to build out what your site could look like. If you hate it, I move on — no cost to you, just time. Worth ten minutes to show you what that actually looks like?"

**Note:** Acknowledges the pushback, justifies why you picked them, and closes with a smaller ask. Match their energy — if they soften, move forward; if they're still annoyed, offer a 90-day callback instead.

---

## Cost ↗ *(branch)*

Tap when they ask "how much does something like this cost?"

**Say this:**
> "Would it be out of line to show you what it looks like first before we even talk about numbers?"

**Note:** This is key — never discuss price until they've seen the site. Seeing it built specifically for them changes the whole conversation.

---

## Hesitate ↗ *(branch)*

Tap when they pause or push back after HOOK without a clear objection.

**Say this:**
> "Is it a bad idea to at least take a look before you decide it's not for you?"

**Note:** Only use if they pause or push back after HOOK. Then advance to CLOSE.

---

## Close 1 — Pound Sand

**Say this:**
> "Look, worst case you spend ten minutes and tell me to pound sand. Best case you actually like it and we can move forward. What's a good day this week?"

**Note:** "Pound sand" is the magic phrase here. Trades guys talk like this. It lowers the social cost of saying no while also making it feel ridiculous to refuse — because the worst case is laughably small.

---

## Close 2 — Walk Away With Ideas

**Say this:**
> "Ten minutes and you'll see exactly what's possible for your business — even if you decide it's not for you, you'll walk away with ideas."

**Note:** Promises a takeaway regardless. Hard to say no to "you'll walk away with ideas" because there's no downside.

---

## Close 3 — Add To What You Built

**Say this:**
> "I put together something that would just add to that. Fifteen minutes — if it doesn't feel right you'll know immediately."

**Note:** The "add to that" framing implies you've earned the right to add to their existing success. Use when the prospect's already been giving "we're doing fine without it" energy.

---

## Narrow time ↗ *(branch)*

Tap when they've agreed in principle but can't pick a specific time.

**Say this:**
> "Evenings probably better, right? I know you're out on jobs during the day. Six or seven?"

**Note:** Binary choice removes the friction of pulling out the calendar — they just pick one. The "I know you're out on jobs" line shows you understand their day.

---

## Confirm

**Say this:**
> "Perfect. What's the best email to send you a calendar invite?"

**Note:** Clean and done. Don't oversell after they agree.

Then:
> "Awesome, I'll get that over to you in a few minutes. Look for it from Shaun Carl Designs. Appreciate the time today — I'll see you [day/time]."

**Note:** The "appreciate the time" lands well with trades guys. Feels genuine, not corporate.

---

# 2. Objection Chips

## 2A. Standard objections (7 chips — one-tap simple rebuttals)

### 1. Word of mouth's fine

> I hear you. But think about this — when your buddy refers you, the next thing that person does is Google you before they call. They see your stars, they see no website, and they wonder if you're even still in business. That hesitation costs you the job before the phone rings. The site's there to back up the referrals you're already getting.

### 2. Already have a Facebook page

> Facebook is great for people who already know you. A website catches the people searching Google at 10pm who have never heard of you — that's a different customer entirely. Want to take a quick look?

### 3. Can't afford it right now

> Fair enough — let's not even talk about money yet. Just take a look at what I built and if it doesn't feel right you'll know immediately. No cost to look at it.

### 4. Had a bad experience before

> I hear that a lot honestly. That's exactly why I built the site before I even called you — you can see the whole thing before you spend a single dollar. Nothing to lose by taking a look.

### 5. Too Busy

> I hear you, you're swamped. But here's the thing: you're busy now, which is great. But what happens in three, four months when things slow down? You'll wish you had this running. Build it now while you're busy, it's working for you by the time you actually need it. Worth ten minutes to see what that looks like?

**Note:** Quick standard-panel version of the seasonal-slowdown play. If they push back or the conversation escalates, jump to the branching **Too busy ↗** chip in Deep Dive for the diagnostic + 5 paths.

### 6. Need to talk to my wife/partner

> Absolutely — would it be easier to get them on the call too so you can both see it at the same time? Saves you having to explain it.

### 7. Why do I need a website? (direct)

Default rebuttal:
> Honestly? Some businesses really don't. But you've got [review_count] reviews at [review_avg] stars — that's a lot of trust people have built up. Right now when someone Googles you they see those stars and then nothing else. A website's just where you put the proof that backs up the reputation you already built. Worth ten minutes to see what that could look like?

**This chip has 4 variant pills the operator can swap between:**

#### Default — "Match your reputation"
(shown above — leans on social proof)

#### Variant — 10pm Googler
> Fair question. Think about it this way — when someone needs a [their trade] at 10pm on a Sunday, they're not asking their neighbor, they're Googling. They land on your profile, see five stars, and then they're stuck. They can't see your work, can't read your story, can't feel comfortable calling a stranger. A website's just there for the folks who need a little more before they pick up the phone. Worth ten minutes to see what I put together?

#### Variant — Quick Fire (scannable bullets)
> ▸ Stops cold calls like this one. Reason I called you is because you don't have a site. Once you have one, guys like me move on.
> ▸ Backs up your referrals. When someone refers you, the next person Googles you. No site = doubt = they call your competitor instead.
> ▸ Filters out tire kickers. People who land on a real site searching with intent are way more qualified than random callers.
> ▸ Builds while you're busy. By the time things slow down, it's already working for you instead of starting from zero.
> ▸ Closes the "are they even still in business?" doubt. Reviews without a website look like maybe you're gone.
> ▸ Lets you charge more. Customers who research you online already trust you before they pick up the phone.
> ▸ Tells you where leads come from. Stop flying blind on marketing.

#### Variant — Busy + referrals
> Fair question. Look, here's what I'm hearing — you're busy, word of mouth works, you don't see the problem. But let me ask you something: when you do get slow, what happens? You start sweating. A website running in the background means by the time winter hits or things slow down, you're already pulling in calls. You built it now while you're slammed, it's working for you when you need it most.

**When to pick which variant:**
- **Default ("Match your reputation")** — leans on social proof. Use when their review count is strong and visible.
- **10pm Googler** — friction-removal angle. Use when review count is low OR they need the late-night-search framing more than social proof.
- **Quick Fire** — scannable list of 7 short benefit one-liners. Use when you need to deliver a sharp benefit fast without reading a paragraph. Pick the one that matches what they just said.
- **Busy + referrals** — late-game synthesis pivot. Use when you've already heard them say they're busy AND that word-of-mouth works — this acknowledges both, then pivots to the seasonal-slowdown anxiety play.

One sharp benefit beats four generic ones. Don't dump the whole list — pick the angle that matches their actual objection.

---

## 2B. Deep Dive · branches (6 chips — branching rebuttals with a diagnostic + paths)

Branching objections work like this: operator taps the chip → cockpit reads the **diagnostic prompt** aloud → prospect answers → operator picks one of the **path cards** that matches how the prospect responded → cockpit displays the matching rebuttal.

### 🛡 Angry Disarm ↗

**Diagnostic prompt (say first):**
> Yeah, fair — I'd be sick of it too. But quick thing: I'm not calling to pitch you. I already built your website. Want to see it?

Then pick the path that matches their response:

**Path A — "You built me a website?"**
> Yeah, I get it — that's bold. But here's the thing: I only do this for businesses I actually want to work with. You didn't have a website, so I used your reviews and Google info to mock something up. If you hate it, I'm gone. No cost, just ten minutes.

**Path B — "I don't need a website, I'm plenty busy"**
> That actually makes sense — you're in your busy season right now which is great. But that also means in 4 months you're going to be staring at a quiet phone wondering where the next job is coming from. Wouldn't it be worth getting something built now so it's already working for you by the time things slow down?

**Path C — "Not worth my time"**
> Look, I get it — you're skeptical. But you're already on the phone with me, and I already built it. Two minutes to look at it costs you nothing. Worst case you hate it and we move on. Best case you see something that actually helps. Fair?

After any path is Handled → advance to the Close stages on the script.

---

### Too busy ↗

**Diagnostic prompt (say first):**
> Totally hear you — are you on a job right now, or is it more that you're just slammed in general?

Then pick a path:

**Path — On a job right now** *(drops ask to 5 minutes)*
> No problem, last thing I want to do is be that guy. What's a good time tomorrow morning or end of day to catch you for 5 minutes?

*Note: Lower the ask and book it now. Don't say "I'll call back" — that puts the work on you and gives them an out.*

**Path — Slammed in general** *(find work they hate doing)*
> That actually makes sense for guys doing it right. Can I ask — are you slammed with the kind of work you want more of, or is it more that you're stuck doing stuff you don't even like anymore?

If they engage:
> That's exactly what a good website does for you — it filters the calls. People who land on your site are searching with intent, not bargain hunters. Worth 15 minutes to see how that works?

**Path — Just brushing me off** *(sets 14-day follow-up)*
> Totally fair — most of the guys I work with were too busy when I first called too. That's actually how I know you're worth calling. Can I check back in two weeks when things might be calmer?

**Path — Plan for when it slows down** *(seasonal anxiety pivot)*
> That actually makes sense — you're in your busy season right now which is great — but that also means in 4 months you're going to be staring at a quiet phone wondering where the next job is coming from. Wouldn't it be worth getting something built now so it's already working for you by the time things slow down?

**Path — Try the assumption flip** *(reverse psychology)*
> It sounds like you might not be the right person to talk to about this anyway — is there someone else who handles the marketing side?

*Note: Most trades owners ARE the marketing person — they'll defensively jump in with "No no, that's me, I just don't have time right now." Now they've established themselves as the decision maker AND given you a softer opening.*

---

### Just send me an email ↗

**Diagnostic prompt (say first):**
> I can absolutely do that — quick question though, when stuff like this hits your inbox do you usually have time to actually look at it, or does it pile up?

Then pick a path:

**Path — They admit inbox piles up** *(drops ask to 10 min)*
> That's exactly why I'd rather just spend 10 minutes on a screen share — you'll see more in 10 minutes than you'd ever get from an email. When's the soonest you've got a quiet 10?

**Path — They still insist on email** *(qualify hard)*
> Yeah I can shoot you something. Just so I send the right thing — what specifically are you looking to see? The website itself, pricing, examples of other businesses I've worked with?

*Note: (1) forces them to engage; (2) tells you what they actually care about; (3) slows the brush-off — most "send me an email" people backpedal here when they realize they have to do work. If they say "just send me whatever" — that's confirmation it's a brush-off; move to the Loom fallback path.*

**Path — "Just send me whatever"** *(Loom fallback)*
> Totally fair. Honestly let me just send you a quick 90-second Loom video where I walk you through it instead — way more useful than a written email and you can watch it on your own time. What's your email?

---

### Too busy + just send email (combo)

Simple chip — no diagnostic, no paths. Tap when they raise both objections at once.

> Yeah I'm not gonna add another email to your pile. Tell you what — what day this week could you spare 10 minutes after work? I'll work around your schedule.

*Note: Acknowledged the busy AND killed the email request in one move. Offering to work around them flips the power dynamic — now you're accommodating, not pushy.*

---

### Why do I need a website? ↗

**Diagnostic prompt (say first):**
> When you get new customers right now, do you know how they found you, or is it kind of a mix?

Then pick a path:

**Path — Don't really know**
> That's the thing right there. Most guys in your spot are great at the work but completely in the dark on the marketing — they know the phone rings, they don't know why. The reason that matters is when you finally do want to grow, you've got no idea which lever to pull. A real website plus a managed Google profile shows you exactly what people searched to find you, which services they're calling about, even which towns they're in. And the piece most guys don't realize — when someone Googles "[their trade] near me" and you don't show up? You didn't lose that customer. You never had a shot at them. Worth ten minutes to show you what that actually looks like?

**Path — All referrals**
> That's the best kind of business, honestly. Here's the catch though — when your buddy refers you, the next person almost always Googles you before they pick up the phone. They see your stars, they see no website, and now they're wondering if you're still in business or if you've got a guy who actually answers. A website's just there to back up the referral that got them there. And when your buddy refers you and they Google you and find nothing, you better believe the next [their trade] on the search results has a website. Worth ten minutes to see what they'd be looking at?

**Path — Already online**
> Then you're already doing the hard part — you've got people finding you. The question is where they go next. Right now if someone clicks your Google profile they see a phone number and some reviews and that's it. A real site is where you tell them why you over the other six guys they're also looking at — because those six guys all have sites already. Fifteen minutes to see what I'd put together?

---

### Total Brush-Off (last resort)

Simple chip — no diagnostic. Last-resort mouthy response when the conversation's already dead.

> Here's the thing though — you know why you're getting hammered with these calls? Because you don't have a website, you're an easy target. Once you have a website, guys like me see that and move on. So building this actually stops the cold calls and starts the real calls from actual customers looking to hire you.

*Note: Tone is mouthy / direct — turns the cold call itself into the value prop. Don't deploy unless the conversation's already dead, because the energy is bordering on confrontational.*

---

# 3. Demo Call Scripts

Used after a cold call books a demo. Two scripts — Tier 3 primary is the default, Tier 2 primary is used when the prospect already has some online presence or when Tier 3 isn't landing.

## 3A. Demo — Tier 3 primary (Growth $499/mo)

**Method:** Tier 3 close, Tier 2 fallback.

**Stages:** Open · Set Agenda · Walkthrough (3 points) · The Pause · Qualify · Tier 3 Pitch · [Handle branches] · Tier 2 Pivot · Tier 3 Seed · Lock Payment · Close · [Handle branches] · Hard No.

### Open — confirm screen share
> Hey [Name], Shaun here — appreciate you making time. Can you see the link I sent over okay?

*If trouble:* "Just open your browser and paste that link in — should take two seconds."

### Set agenda
> So here's what I want to do — walk you through what I built in about 10 minutes, then I want to hear what you think and talk about how we'd actually work together. Sound good?

*Getting a yes here sets the tone that this is a two-way conversation.*

### Walkthrough (3 points)
> Alright so this is your homepage — your name, your number, your reviews. Everything on this page has one job — get someone to call you. This is what someone finds when they search [their trade] in Green Bay at night instead of finding nothing.

*Hit: (1) their branding on it, (2) phone number prominent on every page, (3) reviews section. Don't over-explain.*

### The pause
> What do you think so far?

*Go completely quiet. Let them react. Listen for confidence level — excited, skeptical, questions? This tells you which direction to go.*

### Qualify
> Can I ask — how are you getting most of your work right now? Word of mouth, Google, repeat customers?

*Word of mouth / no online presence = Tier 3. Already getting Google traffic = consider Tier 2.*

### Tier 3 pitch ($499/mo)
> So based on what you're telling me, there's a real opportunity here. Most of your competitors in Green Bay are showing up on Google and you're not even in the game yet — that's actually good news because the low-hanging fruit is still there.
>
> The way I work with businesses like yours is on a Growth plan — I build you the full website, then every single month I'm actively managing your Google Business Profile and adding 3 new service area pages to your site. So month by month you start showing up when someone in De Pere searches for a plumber, or someone in Ashwaubenon needs a roofer — you're not just ranking in Green Bay, you're expanding your footprint across the whole area.
>
> By the end of your first 6 months you'll have 18 new pages working for you around the clock. That's not something your competitors are doing.
>
> It's $499 a month with a 6-month commitment — and the full website build is completely free, so nothing out of pocket outside of the first month to get started.

*Then stop talking. Don't justify it, don't add to it. Let it sit.*

### Handle — Engaged (branch)
> The way most of my clients think about it is — if this gets you even one or two extra jobs a month it's already paying for itself. And for most trades that's a conservative number once Google starts working for you.

### Handle — Monthly cost (branch)
> What are you spending right now to get new customers — whether that's HomeAdvisor, word of mouth, whatever you're doing? Because this replaces all of that with something you actually own.

### Handle — 6-month commit (branch)
> The reason I ask for 6 months is that Google takes time — I could promise you results in 30 days but that wouldn't be honest. Most clients start seeing real movement around month 3. The commitment protects both of us.

### Tier 2 pivot (branch)
> Let me ask you something — do you feel like you're pretty solid on getting found online, you just want something more professional to send people to?

*If yes, pivot:*
> Then honestly the Growth plan might be more than you need right now. I also do a straight build-and-maintain — I build you the full site, get it live, and then keep it updated and running for $79 a month. One-time setup is $400. That gets you a professional presence without the bigger monthly commitment.
>
> A lot of guys start here and then upgrade once they see what a good web presence can do for them.

### Tier 3 seed after Tier 2 yes (branch)
> And just so you know, a lot of my clients move up to my Growth plan once they see what's possible — that's where I'm managing your Google Business Profile every month and adding 3 new service area pages. By month 6 you've got 18 pages working for you across the whole area.
>
> That's $499 a month and the website is completely free — no build fee, no setup cost, nothing outside of the first month. Some guys find it actually makes more sense to just start there rather than pay the $400 separately.

### Lock first payment
> I like to get the first month handled when we wrap up so I can get your Google Business Profile claimed and start the clock — the sooner that's active the sooner Google starts paying attention.

*First payment triggers Merchynt onboarding and GBP claim. Don't leave the call without it.*

### Close
> Want to move forward? I just need your logo if you have one, confirm the phone number is right, and I can have this live within the week.

*Move immediately into logistics. Don't linger on the close or they'll talk themselves out of it.*

### Handle — "Need to think" (branch)
> Totally fair — what's the main thing you'd be thinking through?

Listen, handle specifically, then:
> What would need to be true for this to be an easy yes?

### Handle — Price (branch)
> What were you thinking something like this would run?

*Let them anchor first. Then work from there. Never apologize for the price.*

### Hard no — wrap clean (branch)
> No problem at all — can I check back in with you in a couple months? Timing matters and I'd rather you come to this when it feels right.

*Always leave the door open. Trades talk to each other.*

---

## 3B. Demo — Tier 2 primary ($400 + $79/mo)

Used when the prospect already has online presence, or when Tier 3 isn't landing. Method: Tier 2 close, Tier 3 upsell after yes.

### Tier 2 pitch ($400 + $79/mo)
> So it sounds like you're already getting some work through Google or word of mouth — you're not starting from zero. What you really need is something professional that does justice to the reputation you've already built.
>
> The way I work with businesses in your situation is a straight build-and-maintain. I build you the full site, get it live, and then I keep it updated, secure, and running every month. It's $400 to get started and $79 a month after that.
>
> You get a professional web presence, your phone number front and center, your reviews on the site — and you're not locked into a big monthly commitment.

*Then stop talking. Let it sit.*

### Tier 3 seed after Tier 2 yes
> Perfect — and just so you know, a lot of my clients start here and then move up to my Growth plan once they see what's possible. That's where I'm actively managing your Google Business Profile every month and adding 3 new service area pages to your site — so instead of just ranking in Green Bay you start showing up in De Pere, Ashwaubenon, Howard, all the surrounding areas. By month 6 you've got 18 pages working for you around the clock.
>
> That's $499 a month and the website is completely free — no build fee, no setup cost, nothing outside of the first month. Some guys find it actually makes more sense to just start there rather than pay the $400 separately.

*Don't push it. Plant the seed and move on.*

### Handle — if they consider T3 (branch)
> The way I'd think about it is — if one extra job a month comes from those service area pages, it's already paid for itself. And for most trades that's a very conservative number.

### Handle — if they stick with T2 (branch)
> Totally fine — once you start seeing traffic coming in we can always talk about stepping it up. I'll check in with you at the 90-day mark and show you what's working.

*The 90-day check-in is your built-in upsell conversation.*

### Lock first payment
> I like to get the first month handled when we wrap up so I can get your Google Business Profile claimed and start the clock — the sooner that's active the sooner Google starts paying attention.

---

# 4. Email Follow-Up Sequence

Three-touch sequence after sending the initial demo email. Then move to 90-day bucket.

### Day 2
> Hey [Name] — Shaun here, just wanted to make sure that didn't get buried. Did you get a chance to look at it?

### Day 5
> Hey [Name] — totally get if it's not the right time. Mind if I check back in a couple weeks?

*Reverse psychology. The "out" makes most people say "no it's fine, let me actually look this week."*

### Day 14 — final
> Hey [Name] — last one from me. I won't keep bugging you, but I'd hate to leave it sitting on the table if you're actually interested. Worth a 5-minute chat?

*"Last one from me" creates urgency. People hate being permanently dropped — they often re-engage just to keep the option open.*

After this — move on. Three touches and out, then put them in a 90-day follow-up bucket.

---

# 5. Quick-Reference Objection Lookup

When the prospect says something, tap this chip:

| Prospect says | Panel section | Chip |
|---|---|---|
| Answers the phone | Script | (Answer → Intro → Hook — linear) |
| "This is a terrible time" | Script | Terrible time ↗ |
| "Not interested" at intro | Script | Not interested ↗ |
| "I'm heading into back-to-back calls" | Script | Busy → Demo ↗ |
| "You built me a website?" | Script | Pushback ↗ |
| "How much does this cost?" | Script | Cost ↗ |
| Hesitates after Hook | Script | Hesitate ↗ |
| Agrees to look but won't pick a time | Script | Narrow time ↗ |
| "Word of mouth's fine" / "I get all my work through referrals" | Standard | Word of mouth's fine |
| "I have a Facebook page" | Standard | Already have a Facebook page |
| "I can't afford it" | Standard | Can't afford it right now |
| "I had a bad experience with someone like you" | Standard | Had a bad experience before |
| "I'm too busy" | Standard | Too Busy — *(if escalates, jump to `Too busy ↗` for the branching flow)* |
| "I need to talk to my wife/partner" | Standard | Need to talk to my wife/partner |
| "Why do I need a website?" | Standard | Why do I need a website? (direct) — pick a variant |
| "I get these calls all the time" (hostile) | Deep dive | 🛡 Angry Disarm ↗ |
| "I'm too busy" (needs deeper handling) | Deep dive | Too busy ↗ |
| "Just send me an email" | Deep dive | Just send me an email ↗ |
| "I'm busy, just send me an email" (both at once) | Deep dive | Too busy + just send email (combo) |
| "Why do I need a website?" (with context) | Deep dive | Why do I need a website? ↗ |
| Nothing else has worked | Deep dive | Total Brush-Off (last resort) |

---

# 6. Rules of Engagement

- **Lead with the demo site hook.** "I built you a website" is the pattern interrupt that separates you from every other cold caller.
- **Never argue with a stated fact.** If they say they have a website, pivot to "how are you ranking?" instead of pushing back. Same rule for any factual claim.
- **Never insult the prospect or their business** — even if provoked. Exit gracefully.
- **Match the rebuttal to the specific objection.** Don't cycle through generic angles when they've told you the actual block.
- **Lock in specific times, not vague windows.** "Tomorrow at seven" beats "sometime tomorrow evening."
- **Confirm the email back before hanging up.** Especially if it sounded unclear over the phone.
- **After a warm prospect converts easily, don't over-pitch.** Move to logistics fast.
- **When they hesitate on timing, narrow with a binary.** "Tonight or tomorrow?" beats "when works for you?"
- **"Fair?" beats "Sound good?"** — asks for agreement rather than commitment.
- **Never discuss price before they've seen the site.** Tap the Cost chip, defer, walk them through the demo first.
- **Some prospects are genuinely done. Exit clean.** They may circle back in 30-60 days.
- **Slow down the first 5 seconds** when dealing with an angry prospect. "Yeah, fair" must sound like a peer agreeing, not a sales tactic.

---

*End of reference. To regenerate: read every file under `agency-os-backend/src/playbook/` and reassemble this doc.*
