# Title: Metric glossary

What each wearable metric in TwinLLM measures, its unit, which device sends it,
and what it cannot tell you. CC BY 4.0, Open Science Foundation. See LICENSE.md.

# Section: Heart rate variability (HRV)

HRV is the variation in time between consecutive heartbeats, in milliseconds (ms).
A higher value usually means the nervous system is in a more rested state; a lower
value often follows hard training, short sleep, alcohol, late meals or illness.

TwinLLM shows HRV from three devices:

- Oura: `sleep.hrv` "Average HRV during sleep", the average over the main sleep period.
- Whoop: `whoop.recovery.hrv` "Whoop HRV RMSSD". RMSSD is the root mean square of
  successive differences between beats, measured during sleep. Stored to 0.1 ms.
- Google Health: `google.daily-heart-rate-variability` "Daily HRV".

All are shown in ms with no decimals.

What it cannot tell you: HRV values from different devices are not comparable,
because each uses its own algorithm and measurement window. HRV varies a lot between
people, so it is only meaningful against the same person's own baseline over weeks.
One night says little; a single low value is not a finding about heart health.

# Section: Heart rate during sleep and resting heart rate

Heart rate is beats per minute (bpm), shown with no decimals.

- Oura: `sleep.hr` "Average heart rate during sleep".
- Whoop: `whoop.recovery.rhr` "Whoop resting HR", measured during sleep.
- Whoop: `whoop.cycle.avg_hr` "Whoop cycle average HR", the average over a whole
  Whoop day (cycle), including activity.
- Google Health: `google.daily-resting-heart-rate` "Resting heart rate" and
  `google.heart-rate` "Heart rate". For Google, TwinLLM keeps the last value of each day.

What it cannot tell you: resting heart rate moves with fitness, temperature,
alcohol, stress and illness, so a change has many possible causes. Sleep heart rate
and daytime heart rate are different measures and should not be compared directly.
Optical wrist and finger sensors can miss beats during movement.

# Section: Blood oxygen saturation (SpO2)

SpO2 is the share of haemoglobin carrying oxygen, as a percent, shown with one decimal.

- Whoop: `whoop.recovery.spo2` "Whoop SpO2", measured during sleep.
- Google Health: `google.oxygen-saturation` "SpO2" and `google.daily-oxygen-saturation`
  "Daily SpO2".

What it cannot tell you: these are optical estimates from a consumer wearable, not
readings from a clinical pulse oximeter. Fit, movement, skin tone, cold hands and poor
circulation all change the reading. Differences of one or two percent are within
device noise.

# Section: Sleep duration and time in bed

- Oura: `sleep.duration` "Total sleep duration", the time actually asleep. Oura sends
  seconds; TwinLLM stores minutes and shows them as hours and minutes, e.g. "7 h 12 min".
- Whoop: `whoop.sleep.in_bed_min` "Whoop time in bed". Whoop sends milliseconds;
  TwinLLM stores minutes. Time in bed includes time awake in bed, so it is longer than
  time asleep.

Oura can record more than one sleep period per day. The main period has no suffix;
naps and other periods are labelled, for example "Total sleep duration (late nap)".

What it cannot tell you: wearables estimate sleep from movement and heart rate, not
from brain activity, so the split between asleep and awake is approximate. Duration
alone says nothing about how restorative the sleep was.

# Section: Sleep efficiency, performance and consistency

All three are percentages, shown with no decimals.

- Oura: `sleep.efficiency` "Sleep efficiency", time asleep divided by time in bed.
- Whoop: `whoop.sleep.efficiency` "Whoop sleep efficiency", the same idea from Whoop.
- Whoop: `whoop.sleep.performance` "Whoop sleep performance", sleep obtained compared
  with the sleep need Whoop estimates for that night.
- Whoop: `whoop.sleep.consistency` "Whoop sleep consistency", how similar bed and wake
  times are across recent days.

What it cannot tell you: the sleep need behind Whoop sleep performance is Whoop's own
estimate, not a measured requirement. Efficiency depends on how the device decides
when you went to bed, which differs between Oura and Whoop.

# Section: Oura sleep score

`sleep.score` "Sleep score" is Oura's 0–100 summary of one night, shown with no
decimals and no unit. Oura combines several contributors (total sleep, efficiency,
restfulness, sleep stages, latency and timing) with its own weighting.

What it cannot tell you: the formula is Oura's and can change between app versions.
A score is not a measurement and is not comparable with scores from other devices.

# Section: Oura readiness score and HRV balance

- `readiness.score` "Readiness score" is Oura's 0–100 summary of how recovered the
  body looks today, from recent sleep, resting heart rate, HRV, body temperature and
  activity.
- `readiness.hrv_balance` "HRV balance contributor" is one of its inputs, 0–100. It
  compares recent HRV with the person's longer-term HRV average.

What it cannot tell you: both are proprietary scores, not physiological units. They
describe the device's estimate of recovery, not a person's health or fitness.

# Section: Activity score, steps and active calories

- Oura: `activity.score` "Activity score", 0–100, Oura's summary of daily movement,
  training load and rest.
- Oura: `activity.steps` "Steps" and Google Health: `google.steps` "Steps", a count
  with no unit. For Google, TwinLLM sums all step records of a day.
- Oura: `activity.active_calories` "Active calories", in kilocalories (kcal), the
  energy the device estimates was spent on activity above resting.

What it cannot tell you: step counts from a ring, a watch and a phone differ for the
same day. Active calories are a model estimate from movement and heart rate, not a
measurement of energy use, and are often off by a wide margin.

# Section: Whoop recovery score

`whoop.recovery.score` "Whoop recovery score" is Whoop's 0–100 daily recovery value,
shown with no decimals. Whoop builds it mainly from overnight HRV, resting heart rate
and sleep; the exact formula is Whoop's own.

What it cannot tell you: recovery is a device score, not a physiological unit. It is
only comparable within the same person and device over time.

# Section: Whoop day strain

`whoop.cycle.strain` "Whoop day strain" is Whoop's cardiovascular load for one cycle
(roughly one day), on a 0–21 scale with one decimal and no unit. It rises with time
spent at higher heart rates. `whoop.cycle.avg_hr` is the average heart rate over the
same cycle.

What it cannot tell you: strain counts heart-rate load only. Strength training and
other efforts that raise heart rate little are under-counted.

# Section: Body weight

`google.weight` "Weight" comes from Google Health, usually from a connected scale or
manual entry. TwinLLM shows kilograms with one decimal. The unit stored with the
reading always wins: a weight saved in pounds stays in pounds and is never converted.

What it cannot tell you: weight alone says nothing about body composition (fat,
muscle, water). Day-to-day changes of a kilogram are common from water and food.

# Section: Other Google Health measures

Google Health also sends `google.distance` "Distance", `google.active-minutes`
"Active minutes" and `google.sleep` "Sleep". TwinLLM labels them but has no fixed
display kind for them, so the number is shown with up to one decimal and the unit
Google sent. For every Google measure except steps, TwinLLM keeps the last value of
each day.

What it cannot tell you: Google Health aggregates data from other apps and devices,
so the original sensor behind a value is not always known.
