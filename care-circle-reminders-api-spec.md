# Care Circle: Reminders \& Notifications Backend Spec

Version 5 | Audience: Backend developer

\---

## 1\. Overview

**Care Circle** app me ek **circle** hota hai. Circle ka **owner** medications, appointments aur tasks schedule karta hai. Circle ke saare **members** ko in schedules ke notifications (FCM) milte hain. Koi bhi member circle me **update** share kar sakta hai, jo sab ko notify hota hai.

Server ka kaam:

* Circle members ke FCM tokens save karna.
* Owner ke bheje hue schedules ke mutabiq **cron/scheduler** se sahi waqt par FCM bhejna.
* Done/status ke mutabiq notifications rokna.
* Har notification ka **title aur body server khud banayega** (reminder, missed, snooze, update, sab ka alag text).

### Important design decision

**Server Firestore access nahi karega.** App Firestore me data save karti hai aur **reminder se related zaroori data** server API par bhi bhejti hai. Server ka apna alag database hoga (SQL/NoSQL jo bhi). Server sirf Firebase ID token verify karne aur FCM bhejne ke liye Firebase Admin SDK use karega.

\---

## 2\. Requirements

### 2.1 Roles

|Role|Detail|
|-|-|
|**Owner**|Circle ka creator. Medications, appointments, tasks add/edit/delete karta hai aur circle delete kar sakta hai.|
|**Member**|Circle ka baaki koi bhi user. Reminders sirf receive karta hai, dose/task/appointment ko done mark sirf owner kar sakta hai,member sirf updates share kar sakta hai.|

"Family" = circle ke saare members **owner ke ilawa**.

### 2.2 FCM registration

* R1: User jab bhi app open kare, har circle ke liye uska FCM token server par register hoga (token us circle me save hoga).
* R2: Ek user ke multiple devices ho sakte hain. Identity **fcmToken** hai (deviceId nahi).
* R3: **Logout par device/token delete nahi hoga.** Is ke liye koi API nahi hai.
* R4: Agar same `fcmToken` kisi aur user ke naam par pehle se save ho (same phone par naya user login kare), to server token ko purane user se hata kar naye user par laga de.
* R5: Invalid token (`registration-token-not-registered`, `invalid-argument`) par FCM bhejte waqt server wo token delete kar de.

### 2.3 Medications (owner schedule karta hai)

* R6: Owner multiple times set kar sakta hai, `daily` ya `specificDays` (custom days).
* R7: **Reminder toggle** (`reminderEnabled`) off ho to owner ko koi notification nahi jayegi.
* R8: **Notify family** (`notifyFamilyOnMiss`) off ho to members ko koi notification nahi jayegi.
* R9: **Remind me before** (`leadTimeMinutes`): dose time se itne minute pehle **sirf owner** ko notification.
* R10: Dose time par agar dose done nahi hua aur `notifyFamilyOnMiss` true hai to **saare members** ko "missed" notification.
* R11: **Snooze** (`snoozeMinutes > 0`): dose done hone tak har `snoozeMinutes` baad **sirf owner** ko notification. Family ko sirf missed par notification jati hai (snooze par nahi).
* R12: Har dose ka done state alag hota hai (per dose bool).

### 2.4 Appointments

* R13: Ek fixed date + time (`startsAt`).
* R14: Wahi toggles: `reminderEnabled`, `notifyFamilyOnMiss`, `leadTimeMinutes`. **Snooze nahi.**
* R15: Appointment ka `status` hota hai: `active` ya `completed`. Completed ho to is ki saari pending notifications band.

### 2.5 Tasks

* R16: Date + time. Repeat: `doesNotRepeat`, `daily` ya `custom` (specific days).
* R17: Wahi toggles: `reminderEnabled`, `notifyFamilyOnMiss`, `leadTimeMinutes`. **Snooze nahi.**
* R18: Task ka `status`: `active` ya `completed`. Completed ho to pending notifications band.

### 2.6 Member notification toggles

* R19: Har member apne liye 4 toggles rakhta hai: Medication, Appointment, Task, Updates reminders.
* R20: Ye toggles **owner par bhi apply** hote hain. Toggle off hone par us module ki koi notification us user ko nahi jayegi.

### 2.7 Updates

* R21: Circle ka koi bhi member (owner bhi) update share kar sakta hai.
* R22: Update share hote hi **saare members ko, owner ko bhi**, notification jati hai. Bhejne wale ko nahi.
* R23: Notification me **update bhejne wale ka naam** hoga.

### 2.8 Deletion

* R24: **Member/account delete:** user ko circles se hata do (uske devices aur prefs delete).
* R25: **Circle delete:** circle ka sab kuch delete (members, devices, reminders, completions, pending jobs).

### 2.9 Notification content

* R26: FCM payload me `title` aur `body` **server banayega** (section 9 ke templates), app sirf dikhayegi.
* R27: Title/body notification `type` ke hisab se alag hoga (before / due / missed / snooze / update).
* R28: Time ka text circle ke timezone me 12-hour format (`08:00 AM`) me hoga.

### 2.10 Non-functional

* R29: Sab write APIs **idempotent**.
* R30: Har request Firebase ID token se authenticate; `uid` sirf token se.
* R31: Notifications dobara/double na jayein (dedupe key).
* R32: Done/status check **send ke waqt** ho, taake cancel logic ki zaroorat na pade.
* R33: Payload me sirf reminder se related fields aayengi (poora Firestore document nahi).

\---

## 3\. Permissions

|API|Owner|Member|
|-|-|-|
|Register FCM, prefs|Yes|Yes|
|Reminder upsert / delete|Yes|No|
|Dose completion, appointment status, task status|Yes|Yes|
|Share update|Yes|Yes|
|Delete member (khud / account)|Yes|Yes|
|Owner kisi member ko remove kare|Yes|No|
|Delete circle|Yes|No|

\---

## 4\. Server Data Model (suggested)

|Table|Fields|
|-|-|
|`circles`|circleId, ownerUid, timezone|
|`members`|circleId, uid, role (`owner`/`member`), displayName, prefs{medication, appointment, task, updates}|
|`devices`|circleId, uid, fcmToken, platform, updatedAt|
|`reminder\_items`|circleId, module, itemId, data (upsert payload), status (`active`/`completed`, appointment/task ke liye)|
|`completions`|circleId, itemId, occurrenceKey, completed, updatedBy, updatedAt (medication)|
|`jobs`|jobId, circleId, itemId, occurrenceKey, type, fireAt, audience, sent, dedupeKey|

\---

## 5\. Common conventions

* Header: `Authorization: Bearer <Firebase ID token>`
* `module`: `medication` | `appointment` | `task`
* Time: **24-hour** `"HH:mm"`; datetime: ISO 8601 with offset (`2026-11-02T10:30:00+05:00`)
* `repeatDays`: **0 = Sunday ... 6 = Saturday**
* `occurrenceKey`: local time `y-m-d-h-m`, **zero-padding ke bagair**. Example: 28 Oct 2026, 8:00 AM = `2026-10-28-8-0`
* `leadTimeMinutes`: 5, 10, 15, 30, 60
* `snoozeMinutes`: 0 (off), 5, 10, 15
* Timezone: circle owner ke register wale `timezone` (IANA, jaise `Asia/Karachi`) se.
* Response codes: `200` OK, `401` token galat, `403` permission nahi / circle ka member nahi, `404` item ya circle nahi mila.

\---

## 6\. APIs

### API list

|#|API|Role|Kaam|
|-|-|-|-|
|1|`POST /v1/circles/{circleId}/devices`|Sab|FCM register|
|2|`PUT /v1/circles/{circleId}/members/me/prefs`|Sab|Member toggles|
|3|`PUT /v1/circles/{circleId}/reminders/{module}/{itemId}`|Owner|Schedule upsert|
|4|`DELETE /v1/circles/{circleId}/reminders/{module}/{itemId}`|Owner|Item delete|
|5|`PUT /v1/circles/{circleId}/reminders/medication/{itemId}/completion`|Sab|Dose done/undo|
|6|`PUT /v1/circles/{circleId}/reminders/appointment/{itemId}/status`|Sab|Appointment status|
|7|`PUT /v1/circles/{circleId}/reminders/task/{itemId}/status`|Sab|Task status|
|8|`POST /v1/circles/{circleId}/updates`|Sab|Update share|
|9|`DELETE /v1/members/me`|Sab|Member/account delete|
|10|`DELETE /v1/circles/{circleId}`|Owner|Circle delete|

### 6.1 Register FCM: `POST /v1/circles/{circleId}/devices`

```json
{
  "fcmToken": "eXyz...",
  "platform": "android",
  "role": "member",
  "displayName": "Sara Miller",
  "timezone": "Asia/Karachi"
}
```

* `(uid, circleId, fcmToken)` par upsert; `members` row bhi upsert (displayName, role).
* Pehli baar member banne par prefs ki sab values `true`.
* Rule R4: agar `fcmToken` kisi aur uid ke naam save hai to wo row hata do.
* App ye call karegi: app open par (har circle ke liye), token refresh par, invite accept ke baad.

### 6.2 Member prefs: `PUT /v1/circles/{circleId}/members/me/prefs`

```json
{ "medication": true, "appointment": true, "task": true, "updates": true }
```

### 6.3 Schedule upsert: `PUT /v1/circles/{circleId}/reminders/{module}/{itemId}`

Edit par server purani completion/status state **preserve** kare. Sirf **future jobs** dobara bane. Upsert ke waqt jis job ka `fireAt` guzar chuka ho, uska notification na bheje.

**Medication**

```json
{

&#x20; "id":"",
  "title": "Paracetamol",
  "scheduleMode": "specificDays",
  "repeatDays": \[1, 3, 5],
  "times": \["08:00", "20:30"],
  "startDate": "2026-10-28",
  "reminderEnabled": true, /\*\* ReminderEnabled ka use siraf yai mean jo owner usko reminder nhi ayai ghn yai functlies backend implement hogi perfect \*\*/
  "notifyFamilyOnMiss": true, /\*\* Family if is true hoga tho family ko reminder and family oh jis type member or oh cercle mn hn \*\*/
  "leadTimeMinutes": 10, /\*\* Lead time minutes only owner ko ayai family ko siraf miss dose pai ayai gha \*\*/
  "snoozeMinutes": 5,/\*\* Snoose time minutes only owner ko ayai family ko siraf miss dose pai ayai gha \*\*/
  "reminderTone": "gentle\_chime"
}
```

* `scheduleMode`: `daily` (repeatDays ignore) | `specificDays`.
* `startDate` se pehle ke din fire nahi honge.

**Appointment**

```json

{  

&#x20; "id":"",
  "title": "Cardiology checkup",
  "startsAt": "2026-11-02T10:30:00+05:00",
  "reminderEnabled": true,
  "notifyFamilyOnMiss": true,
  "leadTimeMinutes": 30,
  "reminderTone": "gentle\_chime"
}
```

**Task**

```json
{
  "id":"",
  "title": "Refill pillbox",
  "repeatMode": "custom",
  "repeatDays": \[0, 6],
  "date": "2026-11-02",
  "time": "09:00",
  "reminderEnabled": true,
  "notifyFamilyOnMiss": true,
  "leadTimeMinutes": 15,
  "reminderTone": "gentle\_chime"
}
```

* `repeatMode`: `doesNotRepeat` (sirf `date` + `time`) | `daily` (`date` se roz) | `custom` (`date` se, sirf `repeatDays` par).

### 6.4 Item delete: `DELETE /v1/circles/{circleId}/reminders/{module}/{itemId}`

Item, uski completions aur pending jobs delete.

### 6.5 Dose completion: `PUT /v1/circles/{circleId}/reminders/medication/{itemId}/completion`

```json
{ "occurrenceKey": "2026-10-28-8-0", "completed": true }
```

`completed: false` = undo. Server `completions` me upsert kare.

### 6.6 Appointment status: `PUT /v1/circles/{circleId}/reminders/appointment/{itemId}/status`

### 6.7 Task status: `PUT /v1/circles/{circleId}/reminders/task/{itemId}/status`

```json
{ "status": "completed" }
```

`status`: `active` | `completed`.

* `completed` par us item ki saari pending jobs (before, due, missed) band.
* `active` par jobs dobara bane.

### 6.8 Update share: `POST /v1/circles/{circleId}/updates`

```json
{
  "updateType": "health",
  "senderName": "Sara Miller",
  "notes": "Mom is feeling better today and took her evening medicine."
}
```

* Sender ko token se pehchano. Sab members (owner bhi) ko bhejo, **sender ko chhor ke**.
* Pref check: `updates`.
* Notification ka title/body section 9 ke template se banega.

### 6.9 Member/account delete: `DELETE /v1/members/me`

* Default: user ko **saare circles** se hata do (members, devices, prefs).
* `?circleId=abc`: sirf us circle se (member leave karne par).
* Owner kisi member ko remove kare: `DELETE /v1/members/{uid}?circleId=abc` (sirf owner).
* Jobs ko touch na karo; recipients send ke waqt resolve hote hain.
* **Account delete ka order:** pehle ye API, phir Firebase Auth account delete (warna token invalid ho jata hai).

### 6.10 Circle delete: `DELETE /v1/circles/{circleId}`

Sirf owner. Circle, members, devices, reminders, completions aur pending jobs sab delete.

\---

## 7\. Notification Rules

T = scheduled time of occurrence. Har recipient ki pref (`medication`/`appointment`/`task`/`updates`) check hogi.

|Module|Kab|Kisko|Shart|`type`|
|-|-|-|-|-|
|Medication|T - leadTime|Sirf owner|`reminderEnabled`, dose done nahi|`med\_before`|
|Medication|T|Owner|`reminderEnabled`, dose done nahi|`med\_due`|
|Medication|T|Family|`notifyFamilyOnMiss`, dose done nahi|`med\_missed`|
|Medication|T + n x snooze|Sirf owner|`snoozeMinutes > 0`, `reminderEnabled`, dose done nahi|`med\_snooze`|
|Appointment|T - leadTime|Sirf owner|`reminderEnabled`, `status = active`|`appt\_before`|
|Appointment|T|Owner|`reminderEnabled`, `status = active`|`appt\_due`|
|Appointment|T|Family|`notifyFamilyOnMiss`, `status = active`|`appt\_missed`|
|Task|T - leadTime|Sirf owner|`reminderEnabled`, `status = active`|`task\_before`|
|Task|T|Owner|`reminderEnabled`, `status = active`|`task\_due`|
|Task|T|Family|`notifyFamilyOnMiss`, `status = active`|`task\_missed`|
|Update|Turant|Sab members (sender ke ilawa)|`updates` pref|`update\_new`|

Notes:

* `reminderEnabled` aur `notifyFamilyOnMiss` **independent** hain. `reminderEnabled = false` ho par `notifyFamilyOnMiss = true`, to owner ko kuch nahi jayega lekin family ko miss par jayega.
* Snooze ka pehla notification T + `snoozeMinutes` par. **Cap:** agli dose tak ya maximum 2 ghante, jo pehle ho.
* Appointment me "done" ka concept `status` hai. Completed na ho to T par family ko `appt\_missed` jata hai.
* Miss grace: server constant `MISS\_GRACE\_MINUTES` (default 0).

\---

## 8\. Scheduler

* `jobs` table me **sirf agla occurrence** rakho (har time-slot ka).
* Cron har minute: `fireAt <= now AND sent = false` jobs uthao.
* Send se pehle done/status check karo (R32). Recipients us waqt resolve karo (members + prefs + role).
* Send ke baad `sent = true` karo aur us slot ka agla occurrence ka job banao.
* `dedupeKey = {itemId}-{occurrenceKey}-{type}`: duplicate job ya double send nahi hona chahiye.
* Upsert (6.3) par us item ki purani **unsent** jobs delete karke nayi banao.
* Retry: FCM ke temporary failure par 2-3 baar retry.

\---

## 9\. Notification Title / Body (server-side templates)

Server `type` ke hisab se `title` aur `body` banayega. Placeholders:

* `{title}`: item ka title (jaise "Paracetamol")
* `{time}`: scheduled time, circle timezone me 12-hour (`08:00 AM`)
* `{lead}`: `leadTimeMinutes` ka text. 5-45 ke liye `10 min`, 60 ke liye `1 hour`.
* `{sender}`: update bhejne wale ka naam
* `{notes}`: update ke notes, 100 characters tak truncate (zyada ho to `...`)

|`type`|Title|Body|
|-|-|-|
|`med\_before`|Medication reminder|`{title} is due at {time} (in {lead})`|
|`med\_due`|Time for your medicine|`Take {title} now ({time})`|
|`med\_missed`|Dose missed|`The {title} dose scheduled at {time} was missed`|
|`med\_snooze`|Dose still pending|`{title} was due at {time}. Please mark it as taken`|
|`appt\_before`|Upcoming appointment|`{title} at {time} (in {lead})`|
|`appt\_due`|Appointment time|`{title} is starting now ({time})`|
|`appt\_missed`|Appointment alert|`{title} scheduled at {time} is not marked as completed`|
|`task\_before`|Task reminder|`{title} is due at {time} (in {lead})`|
|`task\_due`|Task due now|`{title} is due now ({time})`|
|`task\_missed`|Task not completed|`{title} was due at {time} and is not marked as completed`|
|`update\_new`|`{sender} shared an update`|`{notes}`|

Ye text reference hai. Backend developer wording thodi badal sakta hai, lekin `type` ke hisab se alag text rahe.

\---

## 10\. FCM Payload

Data-only message (saari values **string**). Server `title` aur `body` bhejta hai, app unhe `flutter\_local\_notifications` se dikhati hai (channel `tone` ke mutabiq).

**Medication / Appointment / Task**

```js
{
  token,
  data: {
    type: "med\_due",
    module: "medication",
    circleId: "abc123",
    itemId: "medId",
    occurrenceKey: "2026-10-28-8-0",
    scheduledAt: "2026-10-28T08:00:00+05:00",
    title: "Time for your medicine",
    body: "Take Paracetamol now (08:00 AM)",
    tone: "gentle\_chime"
  },
  android: { priority: "high" }

} important note: for example notification agr koi dose miss hojayai tho uski tittle body usi hisab sn hogi and agr owener ko remind krnai reminde krnai notification title body change same isi trah same depend krti hn seaswation pr


```

**Update**

```js
{
  token,
  data: {
    type: "update\_new",
    module: "update",
    circleId: "abc123",
    updateType: "health",
    title: "Sara Miller shared an update",
    body: "Mom is feeling better today and took her evening medicine.",
    tone: "gentle\_chime"
  },
  android: { priority: "high" }
}
```

\---

## 11\. Open Items / Known Limitations

1. **Logout par token delete nahi hota (R3).** Is ka matlab logged-out device ko bhi notifications milti rahengi jab tak naya user login na kare ya FCM token invalid na ho. App side par logout ke baad aane wali notifications ignore karo.
2. **Language:** app me language option hai (en/ur), lekin server abhi sirf English `title`/`body` banata hai. Urdu chahiye to register me `locale` field add karni hogi.
3. **Repeating task:** task ka ek hi `status` hai. `completed` karne par uske **saare future occurrences** band ho jayenge. Har din alag complete karna ho to task ke liye bhi medication jaisa `occurrenceKey + completed` wala endpoint chahiye.
4. **Appointment `status`** Firestore model me abhi nahi hai, app me add hoga.
5. **Owner ka account delete:** circle me owner nahi bachega. App me pehle circle delete karwao ya ownership transfer ka flow rakho.
6. **Membership verify:** server Firestore nahi dekhta, isliye circle ka **pehla registered owner server par lock** ho jaye aur owner-only APIs sirf wahi call kar sake. Warna koi bhi user circleId jaan kar `role: "owner"` bhej sakta hai.
7. **Backfill:** jo items pehle se Firestore me hain unhe server par pahunchane ke liye owner ke app open par ek bar sab upsert `PUT` karo (status/completion alag bhejne honge).
8. **Sync failure:** Firestore write ke baad API fail ho to app retry queue rakhe, warna reminders sync se bahar ho jayenge.
9. **iOS:** data-only background delivery reliable nahi hoti; iOS support ho to `content-available` + fallback notification alag decide karna hoga.

