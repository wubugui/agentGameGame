export const meta = {
  name: 'mir2-visual-qa-loop',
  description: 'Screenshot the game, review it against Mir2 with a strict adversarial panel, fix the confirmed defects, repeat until dry',
  phases: [
    { title: 'Capture', detail: 'headless Chromium boots the game and shoots every scene set' },
    { title: 'Review', detail: 'independent reviewers grade the frames on separate axes' },
    { title: 'Verify', detail: 'adversarial pass — refute findings that are taste, not defect' },
    { title: 'Fix', detail: 'one agent per owned file, disjoint writes' },
  ],
}

const REPO = '/home/user/agentGameGame'
const SHOTS = `${REPO}/shots`

// Each reviewer sees the same frames through a different lens. Redundant
// reviewers agree with each other and miss the same things; diverse ones don't.
const LENSES = [
  {
    key: 'terrain',
    title: '地形与地表材质',
    owns: ['src/world/Terrain.js', 'src/gfx/TextureForge.js'],
    ask: `Judge the GROUND and the terrain silhouette only. Is the surface believable at
both the wide shot and the close shot? Look for: visible texture tiling, mush at
distance, flat untextured slabs, muddy cross-fades between splat layers instead
of crisp height-blended transitions, missing road/path definition, water that
reads as a blue plane rather than water, shorelines with no foam or depth
gradient, terrain that is suspiciously flat or suspiciously noisy.`,
  },
  {
    key: 'props',
    title: '建筑、植被与场景构成',
    owns: ['src/world/Props.js', 'src/world/MapDefs.js'],
    ask: `Judge the BUILT WORLD and vegetation. Does 比奇省 read as a town someone lives in
— streets, frontage, a plaza, walls with a gatehouse — or as objects scattered on
a field? Do the buildings have the East-Asian timber-and-tile idiom (upturned
eaves, ridge beams, visible posts, paper screens) or are they textured boxes? Are
trees actually branched? Do instances vary in scale, rotation and tint, or do you
see a repeating stamp? Is anything floating above or sunk into the ground? Is
there foliage wind motion?`,
  },
  {
    key: 'chars',
    title: '角色、怪物与动画',
    owns: ['src/entities/CharacterRig.js', 'src/entities/Armory.js', 'src/entities/Animator.js', 'src/entities/Bestiary.js'],
    ask: `Judge CHARACTERS and MONSTERS. Are they capsule-people or do they have real
silhouette (shoulders, tapered limbs, robe skirts, defined heads)? Is the class
readable at a glance — broad warrior vs lean robed mage vs layered Taoist? Do
monsters read as their species from the game camera distance? Are bosses visibly
bosses (scale, glow, distinct outline)? In the combat frames: is the pose a real
weighted attack with anticipation and follow-through, or a limb sticking out? Any
broken joints, inverted limbs, feet below the ground, or T-poses?`,
  },
  {
    key: 'light',
    title: '光照、天空与大气',
    owns: ['src/gfx/Sky.js', 'src/gfx/Weather.js', 'src/gfx/PostFX.js'],
    ask: `Judge LIGHT and ATMOSPHERE. Compare the day, dawn and night frames. Is there a
real key/fill/bounce relationship or is everything uniformly lit? Are shadows
present, correctly directed, and sharp enough to read (not a blurry smear)? Is
night blue and readable or crushed to black? Does fog agree with the sky colour?
Is bloom making torches and magic glow without washing out daylight? Is the image
washed out or crushed — a tone-mapping double-apply? In the storm/snow frames, is
the precipitation convincingly directional with impact response?`,
  },
  {
    key: 'vfx',
    title: '战斗表现与特效',
    owns: ['src/gfx/Particles.js', 'src/gfx/Materials.js'],
    ask: `Judge COMBAT FEEL and VFX. In the combat frames, is there visible impact — hit
sparks, blood, an arc-shaped slash ribbon oriented to the swing? Do spell effects
have a bright core, a corona, a trailing element and a light they cast on the
world, or are they flat sprites? Do particles look like soft volumetric puffs or
like hard-edged squares? Any obviously wrong blend mode (black boxes around
additive sprites)? Do hot things actually appear hot?`,
  },
  {
    key: 'ui',
    title: 'UI 与 Mir2 神韵',
    owns: ['src/ui/Hud.js', 'styles/ui.css'],
    ask: `Judge the UI. Does it read as a late-90s Korean/Chinese MMO client — bronzed
beaten-metal panels, carved gold filigree, deeply bevelled sunken slots, glassy
HP/MP tubes, CJK serif headings? Or does it read as a modern web app (flat fills,
pill buttons, modern drop shadows, sans-serif body in panels)? Is the layout
Mir2's (bars top-left, command bar bottom, minimap top-right)? Is anything
clipped, overlapping, misaligned, or unreadable against the world behind it?`,
  },
]

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['grade', 'verdict', 'findings'],
  properties: {
    grade: { type: 'number', description: '0-100. 90+ means it would pass in a shipped commercial game.' },
    verdict: { type: 'string', description: 'Two sentences: the single best thing and the single worst thing you saw.' },
    findings: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['shot', 'defect', 'why', 'file', 'severity'],
        properties: {
          shot: { type: 'string', description: 'which screenshot file' },
          defect: { type: 'string', description: 'what is visibly wrong, stated as an observation of the image' },
          why: { type: 'string', description: 'the likely cause in code' },
          file: { type: 'string', description: 'repo-relative file most likely responsible' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reason'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

const round = (args && args.round) || 1
const maxRounds = (args && args.maxRounds) || 1

log(`QA round ${round}`)

// ---------------------------------------------------------------- Capture
phase('Capture')

const capture = await agent(
  `Run the screenshot harness for the Mir2 Three.js game.

  cd ${REPO} && node tools/shoot.mjs --out shots --shots town,field,combat,night,dungeon,weather,ui,boss --quality ultra

It boots the game in headless Chromium and writes PNGs plus shots/console.log
and shots/perf.json.

If it exits non-zero or a scene set fails, that is the most important thing you
can report — READ shots/console.log, find the actual JavaScript error, and trace
it to the responsible source file. Do NOT fix anything; just diagnose precisely.

Report which shots exist on disk (ls shots/), the console error summary, and the
perf numbers.`,
  {
    label: 'capture',
    phase: 'Capture',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'shots', 'errors', 'perf'],
      properties: {
        ok: { type: 'boolean', description: 'true if the game booted and rendered without page errors' },
        shots: { type: 'array', items: { type: 'string' } },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['message', 'file'],
            properties: { message: { type: 'string' }, file: { type: 'string' } },
          },
        },
        perf: { type: 'string', description: 'median/p95 frame ms, draw calls, triangles' },
      },
    },
  }
)

if (!capture || !capture.ok) {
  log('capture failed — the game does not render; routing straight to repair')
  return {
    round,
    blocked: true,
    reason: 'game failed to boot or render',
    errors: capture ? capture.errors : [],
    perf: capture ? capture.perf : null,
  }
}

log(`captured ${capture.shots.length} frames · ${capture.perf}`)

// -------------------------------------------------- Review → Verify → Fix
// Pipelined: a lens that finishes reviewing starts verifying while the others
// are still looking at frames. No barrier between the stages.
phase('Review')

const reviewed = await pipeline(
  LENSES,

  // Stage 1 — look at the frames through one lens.
  (lens) => agent(
    `You are a hostile art-director reviewing a 3D homage to 《热血传奇》(Legend of
Mir 2) built in Three.js. Your specialism: ${lens.title}.

LOOK AT THE ACTUAL IMAGES. Use the Read tool on each PNG in ${SHOTS}/ — they are
real screenshots and Read renders them for you. A review written from source code
instead of from the images is worthless and will be discarded. Read at minimum:
${capture.shots.slice(0, 14).map((s) => `  ${SHOTS}/${s}`).join('\n')}

${lens.ask}

Grade honestly against COMMERCIAL games, not against "good for procedural" or
"good for a browser". Anchor at: 60 = a competent hobby project; 75 = an indie
release; 90 = would ship. Most first drafts are 45-65 and saying so is useful.
Inflating the grade wastes the next round.

Every finding must be an observation OF THE IMAGE — something you can point at.
"The grass texture repeats on a visible ~4m grid across the whole field in
03-field-wide" is a finding. "Textures could be more detailed" is not; discard it.
Rank by how much fixing it would improve the frame.

You may read source under ${REPO}/src/ to attribute a defect to a file, but only
AFTER you have seen it in an image. Do not edit anything.`,
    { label: `review:${lens.key}`, phase: 'Review', schema: FINDINGS, effort: 'high' }
  ).then((r) => ({ lens, review: r })),

  // Stage 2 — adversarially verify this lens's findings.
  ({ lens, review }) => {
    if (!review || !review.findings || !review.findings.length) return { lens, review, confirmed: [] }
    return parallel(review.findings.map((f) => () =>
      agent(
        `A reviewer claims this defect in a screenshot of a Three.js game. Your job is
to REFUTE it. Default to refuted unless the image plainly shows the defect.

  screenshot: ${SHOTS}/${f.shot}
  claim:      ${f.defect}
  blamed:     ${f.file}
  severity:   ${f.severity}

Read the image with the Read tool and look for yourself. Refute if: the defect is
not actually visible; it is a matter of taste rather than a defect; it is an
artifact of the headless software renderer rather than the game; the blamed file
could not possibly cause it (check the source); or the claim is vague enough that
no specific change would resolve it.

Confirm ONLY if you can state the concrete change that would fix what you see.`,
        { label: `verify:${lens.key}:${f.severity}`, phase: 'Verify', schema: VERDICT }
      ).then((v) => (v && v.real ? { ...f, lens: lens.key, reason: v.reason } : null))
    )).then((vs) => ({ lens, review, confirmed: vs.filter(Boolean) }))
  }
)

const lanes = reviewed.filter(Boolean)
const confirmed = lanes.flatMap((l) => l.confirmed)
const grades = Object.fromEntries(lanes.map((l) => [l.lens.key, l.review ? l.review.grade : null]))
const verdicts = Object.fromEntries(lanes.map((l) => [l.lens.key, l.review ? l.review.verdict : null]))
const scores = Object.values(grades).filter((g) => typeof g === 'number')
const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0

log(`avg ${avg}/100 · ${confirmed.length} confirmed defects (of ${lanes.reduce((n, l) => n + (l.review?.findings?.length || 0), 0)} claimed)`)

if (!confirmed.length) {
  return { round, avg, grades, verdicts, confirmed: [], fixed: [], perf: capture.perf, converged: true }
}

// ------------------------------------------------------------------- Fix
// Group by owning file so two agents never write the same file concurrently.
phase('Fix')

const byFile = {}
for (const f of confirmed) {
  const owner = LENSES.find((l) => l.owns.includes(f.file))
  const key = f.file && f.file.startsWith('src/') || f.file?.startsWith('styles/') ? f.file : (owner ? owner.owns[0] : 'src/world/Props.js')
  ;(byFile[key] = byFile[key] || []).push(f)
}

const fixed = await parallel(Object.entries(byFile).map(([file, items]) => () =>
  agent(
    `Fix confirmed visual defects in the Mir2 Three.js game at ${REPO}.

YOU OWN EXACTLY ONE FILE: ${REPO}/${file}
Do not edit any other file — other agents are editing theirs right now, in
parallel. If the real fix belongs elsewhere, say so in your report instead.

Confirmed defects attributed to your file (each was independently verified
against the screenshot, so they are real):

${items.map((f, i) => `${i + 1}. [${f.severity}] in ${f.shot}\n   observed: ${f.defect}\n   likely cause: ${f.why}\n   verifier: ${f.reason}`).join('\n\n')}

The screenshots are at ${SHOTS}/ — READ THE RELEVANT ONES so you are fixing what
is actually wrong rather than what the text describes.

Rules:
- ${REPO}/docs/CONTRACTS.md is normative. Your exported signatures must not change.
- No runtime network access, no external assets. Everything procedural.
- Don't regress performance to buy fidelity: current frame cost is ${capture.perf}.
  Gate anything expensive behind ctx.quality.
- Run node --check on the file when you are done.

Fix the substance, not the symptom. If the grass tiles visibly, adding more noise
octaves is a symptom fix; breaking up the repeat with a low-frequency macro
variation layer is the real one.`,
    { label: `fix:${file.split('/').pop()}`, phase: 'Fix', effort: 'high', schema: {
      type: 'object',
      additionalProperties: false,
      required: ['file', 'changes', 'checked'],
      properties: {
        file: { type: 'string' },
        changes: { type: 'array', items: { type: 'string' }, description: 'what you actually changed' },
        checked: { type: 'boolean', description: 'node --check passed' },
        misattributed: { type: 'array', items: { type: 'string' }, description: 'defects that belong to another file' },
      },
    } }
  )
))

return {
  round,
  avg,
  grades,
  verdicts,
  perf: capture.perf,
  confirmed: confirmed.map((f) => `[${f.severity}][${f.lens}] ${f.shot}: ${f.defect}`),
  fixed: fixed.filter(Boolean).map((f) => ({ file: f.file, changes: f.changes, checked: f.checked })),
  misattributed: fixed.filter(Boolean).flatMap((f) => f.misattributed || []),
  converged: false,
}
