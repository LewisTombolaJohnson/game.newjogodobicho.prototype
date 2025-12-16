import { Application, Container, Graphics, Text } from 'pixi.js'

const WIDTH = 450
const HEIGHT = 800
const CABINET_H = Math.floor(140 * 0.6) // reduce by 40%
const BG_COLOR = 0x14181c
const TEXT_COLOR = 0xeeeeee
const ACCENT = 0xffb648
const BUTTON_BG = 0x2a2e32
const BUTTON_HOVER = 0x34383c
let pendingNewTicketIndex: number | null = null

// Animals list and corresponding emoji (approximate matches)
const ANIMALS = [
  'Ostrich', 'Eagle', 'Donkey', 'Horse', 'Goat',
  'Cow', 'Ram', 'Camel', 'Snake', 'Rabbit',
  'Tiger', 'Cat', 'Buffalo', 'Monkey', 'Dog',
  'Pig', 'Goose', 'Deer', 'Lion', 'Elephant',
  'Zebra', 'Bull', 'Bear', 'Deerhound', 'Ox',
] as const
const ANIMAL_EMOJI: Record<string, string> = {
  Ostrich: '🦩', // closest available
  Eagle: '🦅',
  Donkey: '🐴',
  Horse: '🐎',
  Goat: '🐐',
  Cow: '🐄',
  Ram: '🐏',
  Camel: '🐪',
  Snake: '🐍',
  Rabbit: '🐇',
  Tiger: '🐯',
  Cat: '🐱',
  Buffalo: '🐃',
  Monkey: '🐒',
  Dog: '🐶',
  Pig: '🐖',
  Goose: '🪿', // modern goose emoji; fallback could be '🐦'
  Deer: '🦌',
  Lion: '🦁',
  Elephant: '🐘',
  Zebra: '🦓',
  Bull: '🐂',
  Bear: '🐻',
  Deerhound: '🐕', // generic dog
  Ox: '🐂',
}

type Animal = typeof ANIMALS[number]

const PAYOUT_MULTIPLIER = 18
const STARTING_BALANCE = 100
// Stakes available in the cabinet (in pounds)
const STAKES = [0.05, 0.10, 0.20, 0.50, 1.00, 2.00] as const
let selectedStakeIndex = 4 // default to £1.00
// Dropdown removed; we cycle stake amounts with round +/- buttons

// App (PixiJS v8 requires async init)
const app = new Application()
const root = document.getElementById('game-root')!
// Single canvas only; cabinet will be a container inside main stage
async function initApp() {
  // Guard against Vite HMR re-running module and creating duplicate canvases
  // Use a global flag on window to track initialization
  const w = window as any
  if (w.__UK_JOGO_INITED) {
    return
  }
  w.__UK_JOGO_INITED = true

  await app.init({ width: WIDTH, height: HEIGHT, backgroundColor: BG_COLOR })
  const canvas = app.canvas as HTMLCanvasElement
  // Enable zIndex sorting to control layering
  app.stage.sortableChildren = true
  // Scale whole stage down by 15% and center it
  const SCALE = 0.85
  app.stage.scale.set(SCALE)
  // Center horizontally, align to top vertically
  app.stage.position.set((WIDTH - WIDTH * SCALE) / 2, 0)
  // Ensure the container is empty before appending canvas (avoid duplicates)
  while (root.firstChild) {
    root.removeChild(root.firstChild)
  }
  // Explicitly style the canvas to ensure the border is visible regardless of external CSS
  canvas.style.border = '2px solid #ffb648'
  canvas.style.borderRadius = '8px'
  canvas.style.display = 'block'
  root.appendChild(canvas)

  // After canvas is attached, proceed with UI setup and initial render
  // Assign zIndex for proper layering: ui < animals < tickets < overlay < cabinet
  ui.zIndex = 10
  animalsContainer.zIndex = 20
  ticketsContainer.zIndex = 30
  overlay.zIndex = 40
  cabinetUI.zIndex = 50

  app.stage.addChild(ui)
  app.stage.addChild(animalsContainer)
  app.stage.addChild(overlay)
  app.stage.addChild(cabinetUI)
  app.stage.addChild(topDrawContainer)
  // Modal container above everything
  modalUI.zIndex = 100
  app.stage.addChild(modalUI)
  // Register global ticker for ticket pulse after app initialization
  app.ticker.add((tkr: any) => {
    const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
    // decrease pulse counters and trigger redraw
    let changed = false
    for (const [tIndex, frames] of Array.from(ticketPulse.entries())) {
      const newFrames = frames - dt
      if (newFrames <= 0) {
        ticketPulse.delete(tIndex)
        changed = true
      } else {
        ticketPulse.set(tIndex, newFrames)
        changed = true
      }
    }
    if (changed) {
      drawTicketsArea()
    }
  })
  layoutAndDraw()
}

// State
let balance = STARTING_BALANCE
let selectedIdx: number | null = null
let lastDraw: number | null = null
let message = ''

// UI containers
const ui = new Container()
const animalsContainer = new Container()
const cabinetUI = new Container()
// Overlay for animations (above everything)
const overlay = new Container()
// Tickets scroll area (between grid and cabinet)
const ticketsContainer = new Container()
const ticketsMask = new Graphics()
let ticketsScrollY = 0
// Animated lift for tickets viewport top (0..400)
let ticketsTopLift = 0
// Auto draw state and top results UI
let autoDrawActive = false
let topDrawResults: number[] = []
const topDrawContainer = new Container()
let topDrawInitialized = false
// Aggregate prize (in pounds) after a draw
let prizeAmount = 0
// Number of revealed animals so far in the current draw (0..5)
let revealCount = 0
// Bonus reveal flags and modal UI
let topDrawBonusFlags: boolean[] = []
let consecutiveBonusCount = 0
let bonusCountThisRound = 0
const modalUI = new Container()
// Per-round chance to force first 3 reveals as bonus
let forceTripleBonusRound = false
// Track whether this round qualifies for a bonus popup (3 consecutive bonus symbols)
let bonusEligibleThisRound = false

type Ticket = { animals: number[]; confirmed: boolean; stake?: number; win: number }
const tickets: Ticket[] = [{ animals: [], confirmed: false, stake: undefined, win: 0 }]
let currentTicketIndex = 0

function makeText(text: string, style?: Partial<ConstructorParameters<typeof Text>[1]>) {
  return new Text(text, {
    fill: TEXT_COLOR,
    fontFamily: 'Arial',
    fontSize: 20,
    ...style,
  })
}

function drawHeader() {
  ui.removeChildren()

  const title = makeText('Jogo Do Bicho', { fontSize: 28, fill: ACCENT, fontWeight: 'bold' })
  title.x = WIDTH / 2 - title.width / 2
  title.y = 16
  ui.addChild(title)

  // Balance will be displayed in the cabinet; show a hint here
  const prompt = makeText('Select up to 5 animals per ticket!', { fontSize: 18, fill: ACCENT })
  prompt.y = 56
  prompt.x = WIDTH / 2 - prompt.width / 2
  ui.addChild(prompt)

  // Top-right help button '?' linking to Rules PDF
  const helpBtnSize = 30
  const helpBtn = makeButton('?', WIDTH - helpBtnSize - 12, 12, helpBtnSize, helpBtnSize, () => {
    window.open('https://global-uploads.webflow.com/63b3249466615535f76d4b4e/63ee65cb72f26dc150c03317_Rules-Jogo-Do-Bicho.pdf', '_blank')
  }, { fontSize: 20 })
  ui.addChild(helpBtn)

  // Top-left bonus trigger 'B' to start bonus round immediately
  const bonusBtnSize = 30
  const bonusBtn = makeButton('B', 12, 12, bonusBtnSize, bonusBtnSize, () => {
    // Trigger base bonus round instantly; award totalMultiplier × £1.00
    showBonusGridRoundAndAward(0.5, 25.0, 5, 1.0)
  }, { fontSize: 20 })
  ui.addChild(bonusBtn)

  if (message) {
    const msg = makeText(message)
    msg.x = 16; msg.y = 520
    ui.addChild(msg)
  }

  if (lastDraw !== null) {
    const drawn = makeText(`Last Draw: ${ANIMALS[lastDraw]}`)
    drawn.x = 16; drawn.y = 548
    ui.addChild(drawn)
  }

  // Top draw results UI: show 5 boxes along the top when auto drawing
  if (autoDrawActive) {
    // Initialize boxes once at the start to avoid wiping previously revealed emojis
    if (!topDrawInitialized) {
      topDrawContainer.removeChildren()
      const cols = 5; const rows = 5
      const pad = 6
      const startY = 96
      const availableWidth = WIDTH - 16*2 - (cols - 1) * pad
      const ticketsViewportHeight = 165
      const availableHeight = (HEIGHT - CABINET_H - ticketsViewportHeight) - startY - (rows - 1) * pad
      const boxSize = Math.floor(Math.min(availableWidth / cols, availableHeight / rows))
      const y = startY
      for (let i = 0; i < 5; i++) {
        const x = 16 + i * (boxSize + pad)
        const box = new Graphics()
        box.beginFill(0x2a2e32)
        box.drawRoundedRect(x, y, boxSize, boxSize, 8)
        box.endFill()
        topDrawContainer.addChild(box)
      }
      topDrawInitialized = true
    }
    // Do not clear or redraw emojis here; fade-in helper manages them
  } else {
    topDrawContainer.removeChildren()
    topDrawInitialized = false
  }
}

function makeButton(label: string, x: number, y: number, w: number, h: number, onClick: () => void, textStyle?: Partial<ConstructorParameters<typeof Text>[1]>) {
  const container = new Container()

  const bg = new Graphics()
  const drawBg = (hover = false) => {
    bg.clear()
    // Hover effect: slight darken; no border here (selection uses separate highlight)
    bg.beginFill(hover ? BUTTON_HOVER : BUTTON_BG)
    bg.drawRoundedRect(0, 0, w, h, 6)
    bg.endFill()
  }
  drawBg(false)
  container.addChild(bg)

  const text = makeText(label, textStyle)
  text.x = w / 2 - text.width / 2
  text.y = h / 2 - text.height / 2
  container.addChild(text)

  container.x = x; container.y = y
  container.eventMode = 'static'
  container.cursor = 'pointer'
  container.on('pointerover', () => drawBg(true))
  container.on('pointerout', () => drawBg(false))
  container.on('pointertap', () => onClick())

  return container
}

// Round button helper for +/- controls
function makeRoundButton(label: string, x: number, y: number, radius: number, onClick: () => void, fill = BUTTON_BG) {
  const container = new Container()
  const bg = new Graphics()
  const drawBg = (hover = false) => {
    bg.clear()
    bg.beginFill(hover ? BUTTON_HOVER : fill)
    bg.drawCircle(0, 0, radius)
    bg.endFill()
  }
  drawBg(false)
  container.addChild(bg)
  const text = makeText(label, { fontSize: Math.floor(radius * 1.1) })
  text.x = -text.width / 2
  text.y = -text.height / 2
  container.addChild(text)
  container.x = x; container.y = y
  container.eventMode = 'static'; container.cursor = 'pointer'
  container.on('pointerover', () => drawBg(true))
  container.on('pointerout', () => drawBg(false))
  container.on('pointertap', () => onClick())
  return container
}

function drawAnimals() {
  animalsContainer.removeChildren()
  // If auto drawing, fade out the grid and disable interaction
  if (autoDrawActive) {
    animalsContainer.alpha = 0.15
    animalsContainer.eventMode = 'none'
    return
  } else {
    animalsContainer.alpha = 1
    animalsContainer.eventMode = 'static'
  }
  // Fit 25 animals in a 5x5 grid of SQUARE tiles above the cabinet
  const cols = 5; const rows = 5
  const pad = 6
  const startY = 96
  const availableWidth = WIDTH - 16*2 - (cols - 1) * pad
  // leave room for tickets viewport (height 165)
  const ticketsViewportHeight = 165
  const availableHeight = (HEIGHT - CABINET_H - ticketsViewportHeight) - startY - (rows - 1) * pad
  const tileSize = Math.floor(Math.min(availableWidth / cols, availableHeight / rows))
  const btnW = tileSize
  const btnH = tileSize
  for (let i = 0; i < ANIMALS.length; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const x = 16 + col * (btnW + pad)
    const y = startY + row * (btnH + pad)
    const emoji = ANIMAL_EMOJI[ANIMALS[i]] ?? '❓'
  const fontSize = Math.floor(tileSize * 0.7)
  const btn = makeButton(emoji, x, y, btnW, btnH, () => selectAnimal(i), { fontSize })

    // Selection highlight only (no hover outlines)
    const highlight = new Graphics()
    highlight.lineStyle(3, ACCENT)
    highlight.drawRoundedRect(btn.x, btn.y, btnW, btnH, 8)
    highlight.visible = selectedIdx === i

    animalsContainer.addChild(btn)
    animalsContainer.addChild(highlight)
  }
}

// Compute grid tile center for an animal index
function getGridTileCenter(i: number) {
  const cols = 5; const rows = 5
  const pad = 6
  const startY = 96
  const availableWidth = WIDTH - 16*2 - (cols - 1) * pad
  const ticketsViewportHeight = 165
  const availableHeight = (HEIGHT - CABINET_H - ticketsViewportHeight) - startY - (rows - 1) * pad
  const tileSize = Math.floor(Math.min(availableWidth / cols, availableHeight / rows))
  const row = Math.floor(i / cols)
  const col = i % cols
  const x = 16 + col * (tileSize + pad) + tileSize / 2
  const y = startY + row * (tileSize + pad) + tileSize / 2
  return { x, y, tileSize }
}

// Compute destination slot center for next slot in a ticket row
function getTicketNextSlotCenter(tIndex: number) {
  const viewportY = HEIGHT - CABINET_H - 165 - 20
  const slotPad = 8
  const baseSlotSize = 34
  const slotSize = Math.floor(baseSlotSize * 1.5)
  // Row start y with scroll offset
  let y = viewportY + 6 + ticketsScrollY
  for (let t = 0; t < tickets.length; t++) {
    // ticket header height
    const headerH = 24
    const rowPad = 12
    if (t === tIndex) {
      y += headerH
      const totalSlotsWidth = (slotSize * 5) + (slotPad * 4)
      const startX = Math.max(12, (WIDTH - totalSlotsWidth) / 2)
      // We push the animal before animating, so target the slot just filled: length - 1
      const filledSlot = Math.max(0, Math.min(4, tickets[t].animals.length - 1))
      const x = startX + (filledSlot * (slotSize + slotPad)) + slotSize / 2
      const centerY = y + slotSize / 2
      return { x, y: centerY, slotSize }
    }
    // advance y for other tickets
    y += headerH
    y += slotSize + rowPad
  }
  // Fallback to top
  return { x: WIDTH / 2, y: viewportY + slotSize / 2, slotSize }
}

// Animate an emoji moving from grid to ticket slot with a particle splash on arrival
function animateAnimalToTicket(emoji: string, fromIdx: number, toTicketIdx: number, onArrive?: () => void) {
  const from = getGridTileCenter(fromIdx)
  const to = getTicketNextSlotCenter(toTicketIdx)
  const txt = makeText(emoji, { fontSize: Math.floor(from.tileSize * 0.7) })
  txt.x = from.x - txt.width / 2
  txt.y = from.y - txt.height / 2
  overlay.addChild(txt)

  const duration = 0.4 // seconds
  let elapsed = 0
  const startX = txt.x, startY = txt.y
  const endX = to.x - txt.width / 2, endY = to.y - txt.height / 2
  const easeOut = (k: number) => 1 - Math.pow(1 - k, 3)
  const ticker = (tkr: any) => {
    // tkr.deltaTime is frames since last tick
    const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
    elapsed += dt / 60
    const t = Math.min(1, elapsed / duration)
    const e = easeOut(t)
    txt.x = startX + (endX - startX) * e
    txt.y = startY + (endY - startY) * e
    txt.alpha = 0.7 + 0.3 * (1 - t)
    if (t >= 1) {
      app.ticker.remove(ticker)
      // Particle splash
      particleSplash(to.x, to.y)
      // Fade out the moving emoji
      fadeOutAndRemove(txt)
      // Notify arrival completion
      if (onArrive) onArrive()
    }
  }
  app.ticker.add(ticker)
}

function fadeOutAndRemove(display: Container | Text | Graphics) {
  let elapsed = 0
  const duration = 0.25
  const tick = (tkr: any) => {
    const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
    elapsed += dt / 60
    const t = Math.min(1, elapsed / duration)
    display.alpha = 1 - t
    if (t >= 1) {
      app.ticker.remove(tick)
      if (display.parent) display.parent.removeChild(display)
    }
  }
  app.ticker.add(tick)
}

function particleSplash(cx: number, cy: number) {
  const count = 10
  for (let i = 0; i < count; i++) {
    const p = new Graphics()
    p.beginFill(ACCENT)
    p.drawCircle(0, 0, 2)
    p.endFill()
    p.x = cx; p.y = cy
    overlay.addChild(p)
    const angle = Math.random() * Math.PI * 2
    const speed = 40 + Math.random() * 60
    let elapsed = 0
    const duration = 0.5
    const tick = (tkr: any) => {
      const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
      elapsed += dt / 60
      const t = Math.min(1, elapsed / duration)
      p.x = cx + Math.cos(angle) * speed * t
      p.y = cy + Math.sin(angle) * speed * t
      p.alpha = 1 - t
      if (t >= 1) {
        app.ticker.remove(tick)
        overlay.removeChild(p)
      }
    }
    app.ticker.add(tick)
  }
}

function drawTicketsArea() {
  ticketsContainer.removeChildren()
  ticketsMask.clear()
  const baseViewportY = HEIGHT - CABINET_H - 165 - 30
  const baseViewportH = 190
  // Move top up by ticketsTopLift while keeping the bottom fixed
  const viewportY = baseViewportY - ticketsTopLift
  const viewportH = baseViewportH + ticketsTopLift
  const viewportX = 0
  const viewportW = WIDTH
  ticketsMask.beginFill(0xffffff)
  ticketsMask.drawRect(viewportX, viewportY, viewportW, viewportH)
  ticketsMask.endFill()
  ticketsContainer.mask = ticketsMask

  const bg = new Graphics()
  bg.beginFill(0x101419)
  bg.drawRect(viewportX, viewportY, viewportW, viewportH)
  bg.endFill()
  ticketsContainer.addChild(bg)

  const rowPad = 12
  const slotPad = 8
  const baseSlotSize = 34
  const slotSize = Math.floor(baseSlotSize * 1.5)
  let y = viewportY + 6 + ticketsScrollY
  for (let t = 0; t < tickets.length; t++) {
    const ticket = tickets[t]

    const ticketBg = new Graphics()
    ticketBg.beginFill(ticket.confirmed ? 0x1f252a : 0x192027)
    ticketBg.drawRoundedRect(8, y, WIDTH - 16, slotSize + 28, 8)
    ticketBg.endFill()
    ticketsContainer.addChild(ticketBg)

    // Pulse effect for confirmed tickets
    const pulseFrames = ticketPulse.get(t) ?? 0
    if (pulseFrames > 0) {
      const pulse = new Graphics()
      const phase = Math.sin((pulseFrames % 20) / 20 * Math.PI)
      const alpha = 0.3 * Math.abs(phase)
      pulse.lineStyle(3, ACCENT, alpha)
      pulse.drawRoundedRect(8, y, WIDTH - 16, slotSize + 28, 8)
      ticketsContainer.addChild(pulse)
    }

    // Only show ticket title (and stake) if there is at least one animal in the ticket
    if (ticket.animals.length > 0) {
      // Read stake from ticket when confirmed
      let stakeSuffix = ''
      if (ticket.confirmed && typeof ticket.stake === 'number') {
        const s = ticket.stake
        const stakeLabel = s >= 1 ? `£${s.toFixed(2)}` : `${Math.round(s * 100)}p`
        stakeSuffix = `  •  Stake: ${stakeLabel}`
      }
      const label = makeText(`Ticket ${t + 1}${stakeSuffix}`, { fontSize: 14, fill: ticket.confirmed ? ACCENT : TEXT_COLOR })
      label.x = 16; label.y = y + 6
      ticketsContainer.addChild(label)
      // Per-ticket running win label on the right (show only during gameplay)
      if (autoDrawActive && ticket.confirmed) {
        const win = Math.max(0, ticket.win || 0)
        const winLabel = makeText(`£${win.toFixed(2)}`, { fontSize: 14, fill: win > 0 ? ACCENT : 0x9aa1a8 })
        winLabel.x = WIDTH - 16 - winLabel.width
        winLabel.y = y + 6
        ticketsContainer.addChild(winLabel)
      }
      // Add a per-ticket delete (close) button during selection state (hidden during gameplay)
      if (!autoDrawActive) {
        const delRadius = 10
        const delX = WIDTH - 16 - delRadius
        const delY = y + 6 + delRadius
        const delBtn = new Graphics()
        delBtn.beginFill(0xc62828)
        delBtn.drawCircle(delX, delY, delRadius)
        delBtn.endFill()
        delBtn.eventMode = 'static'
        delBtn.cursor = 'pointer'
        delBtn.on('pointertap', () => {
          // Delete this ticket
          tickets.splice(t, 1)
          // Ensure there's always at least one empty ticket at the top
          const hasEmptyTop = tickets[0] && !tickets[0].confirmed && tickets[0].animals.length === 0
          if (!hasEmptyTop) {
            tickets.splice(0, 0, { animals: [], confirmed: false, stake: undefined, win: 0 })
          }
          drawTicketsArea()
          drawCabinet()
        })
        ticketsContainer.addChild(delBtn)
        const delTxt = makeText('×', { fontSize: 14, fill: 0xffffff })
        delTxt.x = delX - delTxt.width / 2
        delTxt.y = delY - delTxt.height / 2
        ticketsContainer.addChild(delTxt)
      }
    }

    y += 24
    // Center the 5 slots horizontally within the ticket width
    const totalSlotsWidth = (slotSize * 5) + (slotPad * 4)
    let x = Math.max(12, (WIDTH - totalSlotsWidth) / 2)
    // If this is an empty ticket and we are showing stake limit messaging, skip drawing the slots
    const totalConfirmedStakeForSlots = tickets.reduce((sum, tt) => sum + ((tt.confirmed && tt.stake) ? tt.stake : 0), 0)
    const currentStakeSelForSlots = STAKES[selectedStakeIndex]
    const atLimitForSlots = (!ticket.confirmed && ticket.animals.length === 0) && totalConfirmedStakeForSlots >= 10.0
    const wouldExceedForSlots = (!ticket.confirmed && ticket.animals.length === 0) && !atLimitForSlots && (totalConfirmedStakeForSlots + currentStakeSelForSlots > 10.0)
    const hideSlotsForEmptyLimit = atLimitForSlots || wouldExceedForSlots
    for (let s = 0; s < 5; s++) {
      if (hideSlotsForEmptyLimit) {
        // Skip rendering individual slots when limit messaging is active
        break
      }
      const idx = ticket.animals[s]
      const emoji = idx !== undefined ? (ANIMAL_EMOJI[ANIMALS[idx]] ?? '❓') : '—'
      const slot = new Graphics()
      slot.beginFill(0x2a2e32)
      slot.drawRoundedRect(x, y, slotSize, slotSize, 6)
      slot.endFill()
      if (idx !== undefined) {
        slot.lineStyle(2, ACCENT)
        slot.drawRoundedRect(x, y, slotSize, slotSize, 6)
      }
      ticketsContainer.addChild(slot)

      const txt = makeText(emoji, { fontSize: Math.floor(slotSize * 0.65) })
      txt.x = x + slotSize / 2 - txt.width / 2
      txt.y = y + slotSize / 2 - txt.height / 2
      ticketsContainer.addChild(txt)

      // Draw hit ticks during/after reveal with clearer badges:
      // - Top green badge if the animal appears anywhere in the revealed set
      // - Bottom green badge if it's an exact positional match among revealed positions
      if (idx !== undefined && revealCount > 0) {
        const revealed = new Set(topDrawResults.slice(0, revealCount))
        const green = 0x00e676 // brighter green
        const dark = 0x009e4f // border shade
        const tickFG = 0xffffff
        const r = Math.max(7, Math.floor(slotSize * 0.16))
        if (revealed.has(idx)) {
          const cx = x + slotSize / 2
          const cy = y + 4 + r
          const badge = new Graphics()
          badge.lineStyle(2, dark, 0.9)
          badge.beginFill(green)
          badge.drawCircle(cx, cy, r)
          badge.endFill()
          ticketsContainer.addChild(badge)
          const topTick = makeText('✓', { fontSize: Math.floor(r * 1.4), fill: tickFG })
          topTick.x = cx - topTick.width / 2
          topTick.y = cy - topTick.height / 2
          ticketsContainer.addChild(topTick)
        }
        if (s < revealCount && topDrawResults[s] === idx) {
          const cx2 = x + slotSize / 2
          const cy2 = y + slotSize - 4 - r
          const badge2 = new Graphics()
          badge2.lineStyle(2, dark, 0.9)
          badge2.beginFill(green)
          badge2.drawCircle(cx2, cy2, r)
          badge2.endFill()
          ticketsContainer.addChild(badge2)
          const bottomTick = makeText('✓', { fontSize: Math.floor(r * 1.4), fill: tickFG })
          bottomTick.x = cx2 - bottomTick.width / 2
          bottomTick.y = cy2 - bottomTick.height / 2
          ticketsContainer.addChild(bottomTick)
        }
      }

      x += slotSize + slotPad
    }

    // For empty tickets (no animals yet), enforce stake limit messaging and optionally show utility buttons
    if (!ticket.confirmed && ticket.animals.length === 0) {
      const totalConfirmedStake = tickets.reduce((sum, tt) => sum + ((tt.confirmed && tt.stake) ? tt.stake : 0), 0)
      const currentStakeSel = STAKES[selectedStakeIndex]
      const atLimit = totalConfirmedStake >= 10.0
      const wouldExceed = !atLimit && (totalConfirmedStake + currentStakeSel > 10.0)

      if (atLimit || wouldExceed) {
        // Hide the slot contents and show the appropriate message centered within the ticket rectangle
        const msg = atLimit
          ? 'Stake limit of £10 reached.'
          : 'Current stake selected will take you over the £10 limit.'
        const msgText = makeText(msg, { fontSize: 16, fill: ACCENT })
        msgText.x = WIDTH / 2 - msgText.width / 2
        msgText.y = y + slotSize / 2 - msgText.height / 2
        ticketsContainer.addChild(msgText)
        // Skip drawing the Clear/Random controls when at/over limit
      } else {
      const radius = 18 // 50% larger than 12
      const centerY = y + slotSize / 2
  let leftX = 16 + radius // near left padding
  let rightX = WIDTH - 16 - radius // near right padding
  // Apply requested offsets: move C right by 10px, R left by 10px
  leftX += 10
  rightX -= 10

      // Brush button (clear all confirmed tickets)
      const clearBtn = new Graphics()
      clearBtn.beginFill(0x2a2e32)
  clearBtn.drawCircle(leftX, centerY, radius)
      clearBtn.endFill()
      clearBtn.eventMode = 'static'; clearBtn.cursor = 'pointer'
      clearBtn.on('pointertap', () => {
        // Remove all confirmed tickets
        for (let i = tickets.length - 1; i >= 0; i--) {
          if (tickets[i].confirmed) tickets.splice(i, 1)
        }
        drawTicketsArea()
        drawCabinet()
      })
      ticketsContainer.addChild(clearBtn)
      // Label 'C' for Clear
      const clearLabel = makeText('C', { fontSize: 18, fill: ACCENT })
  clearLabel.x = leftX - clearLabel.width / 2
      clearLabel.y = centerY - clearLabel.height / 2
      ticketsContainer.addChild(clearLabel)

      // Shuffle button (build random ticket here)
      const shuffleBtn = new Graphics()
      shuffleBtn.beginFill(0x2a2e32)
  shuffleBtn.drawCircle(rightX, centerY, radius)
      shuffleBtn.endFill()
      shuffleBtn.eventMode = 'static'; shuffleBtn.cursor = 'pointer'
      shuffleBtn.on('pointertap', () => {
        buildRandomTicketAt(t)
      })
      ticketsContainer.addChild(shuffleBtn)
      // Label 'R' for Random
      const randomLabel = makeText('R', { fontSize: 18, fill: ACCENT })
  randomLabel.x = rightX - randomLabel.width / 2
      randomLabel.y = centerY - randomLabel.height / 2
      ticketsContainer.addChild(randomLabel)
      }
    }

    // Hide icons if confirmed; otherwise show Cancel (✕) and Confirm (✓)
    // Additionally, do not show any icons if the ticket has zero animals
    if (!ticket.confirmed && ticket.animals.length > 0) {
      // Stack vertically on the right: Confirm (top), Cancel (bottom)
      const radius = 12 // 25% smaller than 16
      const rightX = WIDTH - 16 - radius
      const centerY = y + slotSize / 2
      const gap = 8

      // Confirm (✓) top
  const confirmY = centerY - radius - gap - 10
      const confirmIcon = new Graphics()
      confirmIcon.beginFill(0x2e7d32)
      confirmIcon.drawCircle(rightX, confirmY, radius)
      confirmIcon.endFill()
      confirmIcon.eventMode = 'static'; confirmIcon.cursor = 'pointer'
        confirmIcon.on('pointertap', () => {
          if (!ticket.confirmed && ticket.animals.length > 0) {
            // Enforce £10 total stake limit before confirming
            const totalConfirmedStake = tickets.reduce((sum, tt) => sum + ((tt.confirmed && tt.stake) ? tt.stake : 0), 0)
            const selStake = STAKES[selectedStakeIndex]
            if (totalConfirmedStake + selStake > 10.0) {
              // Do not confirm; rely on empty ticket warning UI
              drawTicketsArea()
              drawCabinet()
              return
            }
            ticket.confirmed = true
            ticket.stake = selStake
            // Remove from original position and insert just below
            const originalIndex = t
            const [removed] = tickets.splice(originalIndex, 1)
            // First insert a new empty ticket at the original index
            tickets.splice(originalIndex, 0, { animals: [], confirmed: false, stake: undefined, win: 0 })
            // Then insert the confirmed ticket just below (at originalIndex + 1)
            const insertIndex = Math.min(tickets.length, originalIndex + 1)
            tickets.splice(insertIndex, 0, removed)
            // Pulse the moved ticket now just below
            ticketPulse.set(insertIndex, 30) // ~0.5s at 60fps
            // Set current ticket to this new empty ticket to continue selection there
            currentTicketIndex = originalIndex
            // Clear any pending flags since we inserted immediately
            needsNewTicket = false
            pendingNewTicketIndex = null
            drawTicketsArea()
            drawCabinet()
          }
        })
      ticketsContainer.addChild(confirmIcon)
      const confirmTxt = makeText('✓', { fontSize: 14 })
      confirmTxt.x = rightX - confirmTxt.width / 2
      confirmTxt.y = confirmY - confirmTxt.height / 2
      ticketsContainer.addChild(confirmTxt)

      // Cancel (✕) bottom
  const cancelY = centerY + radius + (gap - 3) - 10
      const cancelIcon = new Graphics()
      cancelIcon.beginFill(0xc62828)
      cancelIcon.drawCircle(rightX, cancelY, radius)
      cancelIcon.endFill()
      cancelIcon.eventMode = 'static'; cancelIcon.cursor = 'pointer'
      cancelIcon.on('pointertap', () => {
        if (!ticket.confirmed) {
          ticket.animals = []
          const originalIndex = t
          drawTicketsArea()
          drawCabinet()
        }
      })
      ticketsContainer.addChild(cancelIcon)
      const cancelTxt = makeText('✕', { fontSize: 14 })
      cancelTxt.x = rightX - cancelTxt.width / 2
      cancelTxt.y = cancelY - cancelTxt.height / 2
      ticketsContainer.addChild(cancelTxt)
    }

    y += slotSize + rowPad
  }

  const maxContentH = tickets.length * (slotSize + rowPad + 24)
  const maxScroll = Math.max(0, maxContentH - viewportH)
  if (maxScroll > 0) {
    const track = new Graphics()
    track.beginFill(0x252a2f)
    track.drawRoundedRect(WIDTH - 8, viewportY + 8, 4, viewportH - 16, 2)
    track.endFill()
    ticketsContainer.addChild(track)

    const thumb = new Graphics()
    const scrollRatio = Math.abs(ticketsScrollY) / maxScroll
    const thumbH = Math.max(20, (viewportH - 16) * (viewportH / maxContentH))
    const thumbY = viewportY + 8 + ((viewportH - 16 - thumbH) * scrollRatio)
    thumb.beginFill(ACCENT)
    thumb.drawRoundedRect(WIDTH - 8, thumbY, 4, thumbH, 2)
    thumb.endFill()
    ticketsContainer.addChild(thumb)
  }
}

// Build a random ticket at a given index with 1-5 unique animals, animate all moves, then auto-confirm and place just below
function buildRandomTicketAt(index: number) {
  const ticket = tickets[index]
  if (!ticket || ticket.confirmed) return
  // Choose k animals at random (1..5), unique
  const remainingSlots = Math.max(0, 5 - ticket.animals.length)
  if (remainingSlots === 0) return
  const k = Math.min(remainingSlots, 1 + Math.floor(Math.random() * 5))
  const indices = [...Array(ANIMALS.length).keys()].filter(i => !ticket.animals.includes(i))
  // shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp
  }
  const picks = indices.slice(0, k)
  currentTicketIndex = index
  let arrivals = 0
  const originalIndex = index
  for (const idx of picks) {
    // place in ticket animals to set destination calculation (length-1)
    if (!ticket.animals.includes(idx) && ticket.animals.length < 5) {
      ticket.animals.push(idx)
    }
    const emoji = ANIMAL_EMOJI[ANIMALS[idx]] ?? '❓'
    animateAnimalToTicket(emoji, idx, originalIndex, () => {
      arrivals++
      // After last arrival, confirm and reposition just below
    if (arrivals === picks.length && !ticket.confirmed) {
  // Enforce £10 total stake limit before confirming
  const totalConfirmedStake = tickets.reduce((sum, tt) => sum + ((tt.confirmed && tt.stake) ? tt.stake : 0), 0)
  const selStake = STAKES[selectedStakeIndex]
  if (totalConfirmedStake + selStake > 10.0) {
    drawTicketsArea()
    drawCabinet()
    return
  }
  ticket.confirmed = true
  ticket.stake = selStake
  // Remove original and then insert empty first, followed by confirmed just below
  const [removed] = tickets.splice(originalIndex, 1)
  // Insert new empty ticket at original index
  tickets.splice(originalIndex, 0, { animals: [], confirmed: false, stake: undefined, win: 0 })
  // Insert confirmed ticket at position originalIndex + 1
  const insertIndex = Math.min(tickets.length, originalIndex + 1)
  tickets.splice(insertIndex, 0, removed)
  ticketPulse.set(insertIndex, 30)
  currentTicketIndex = originalIndex
        drawTicketsArea()
      } else {
        drawTicketsArea()
        drawCabinet()
      }
    })
  }
}

// Update selectAnimal to auto-create new ticket after auto-confirm
function selectAnimal(idx: number) {
  selectedIdx = idx
  const ticket = tickets[currentTicketIndex]
  // If the current ticket is confirmed and we flagged needing a new ticket, create it now
  if (ticket.confirmed && needsNewTicket) {
    const insertIdx = pendingNewTicketIndex ?? tickets.length
  tickets.splice(insertIdx, 0, { animals: [], confirmed: false, stake: undefined, win: 0 })
    currentTicketIndex = insertIdx
    needsNewTicket = false
    pendingNewTicketIndex = null
  }
  const activeTicket = tickets[currentTicketIndex]
  if (!activeTicket.confirmed) {
    if (activeTicket.animals.length < 5 && !activeTicket.animals.includes(idx)) {
      // animate move from grid to ticket next slot and confirm only after arrival
      const emoji = ANIMAL_EMOJI[ANIMALS[idx]] ?? '❓'
      activeTicket.animals.push(idx)
      const originalIndex = currentTicketIndex
      animateAnimalToTicket(emoji, idx, currentTicketIndex, () => {
        if (tickets[originalIndex] && tickets[originalIndex].animals.length === 5 && !tickets[originalIndex].confirmed) {
          // Auto-confirm: move this ticket to bottom and create a new empty one at the same index
          tickets[originalIndex].confirmed = true
          tickets[originalIndex].stake = STAKES[selectedStakeIndex]
          const [removed] = tickets.splice(originalIndex, 1)
          // Insert a new empty ticket at original index first
          tickets.splice(originalIndex, 0, { animals: [], confirmed: false, stake: undefined, win: 0 })
          // Then insert the confirmed ticket just below
          const insertIndex = Math.min(tickets.length, originalIndex + 1)
          tickets.splice(insertIndex, 0, removed)
          // Pulse the moved ticket now just below
          ticketPulse.set(insertIndex, 30)
          // Focus selection on the new empty ticket
          currentTicketIndex = originalIndex
          // Clear deferred flags
          needsNewTicket = false
          pendingNewTicketIndex = null
          // Redraw to reflect changes after arrival
          drawTicketsArea()
          drawCabinet()
        } else {
          // Just redraw to show the placed animal
          drawTicketsArea()
          drawCabinet()
        }
      })
    }
  }
  setError('')
  drawHeader()
  drawAnimals()
  drawTicketsArea()
}

// Error messaging via main UI text area (no HTML controls)
let lastError = ''
function setError(text: string) {
  lastError = text
  // Show error as part of the message line
  message = text ? `Error: ${text}` : message
  drawHeader()
}

function resetRound() {
  selectedIdx = null
  lastDraw = null
  message = 'Round reset. Pick an animal and bet.'
  lastError = ''
  drawHeader()
  drawAnimals()
  drawTicketsArea()
}

function placeBet() {
  setError('')
  if (selectedIdx === null) {
    setError('Please select an animal first.')
    return
  }
  const betAmount = STAKES[selectedStakeIndex]
  if (betAmount > balance) {
    setError('Insufficient balance.')
    return
  }

  balance -= betAmount
  const winningIdx = Math.floor(Math.random() * ANIMALS.length)
  lastDraw = winningIdx
  if (winningIdx === selectedIdx) {
    const winnings = betAmount * PAYOUT_MULTIPLIER
    balance += winnings
    message = `You WON! ${ANIMALS[winningIdx]} drawn. Payout: £${winnings}.`
  } else {
    message = `You lost. ${ANIMALS[winningIdx]} drawn.`
  }

  drawHeader()
  drawTicketsArea()
}

// Auto draw sequence: fade out grid, show top boxes, and pick 5 unique animals with 2s delay
async function startAutoDraw() {
  if (autoDrawActive) return
  // Safety: require at least one confirmed ticket before starting
  const anyConfirmed = tickets.some(t => t.confirmed)
  if (!anyConfirmed) return
  autoDrawActive = true
  topDrawInitialized = false
  // Reset reveal counter and per-ticket running wins
  revealCount = 0
  topDrawBonusFlags = []
  consecutiveBonusCount = 0
  bonusCountThisRound = 0
  bonusEligibleThisRound = false
  // Roll for a forced triple-bonus round (10% chance per round)
  forceTripleBonusRound = Math.random() < 0.10
  for (const t of tickets) {
    t.win = 0
  }
  // Remove any empty tickets
  for (let i = tickets.length - 1; i >= 0; i--) {
    if (tickets[i].animals.length === 0) {
      tickets.splice(i, 1)
    }
  }
  // Ensure all non-empty tickets participate by auto-confirming them at play start
  for (const t of tickets) {
    if (!t.confirmed && t.animals.length > 0) {
      t.confirmed = true
      if (typeof t.stake !== 'number') {
        t.stake = STAKES[selectedStakeIndex]
      }
    }
  }
  // Deduct stakes for this round upfront (only from confirmed tickets)
  const totalStake = tickets.reduce((sum, t) => sum + ((t.confirmed && t.stake) ? t.stake : 0), 0)
  if (totalStake > 0) {
    balance -= totalStake
  }
  // Reset prize display to zero at the start of the draw
  prizeAmount = 0
  drawCabinet()
  // Reset scroll to top
  ticketsScrollY = 0
  // Animate tickets viewport top lift to 400px
  animateTicketsTopLift(335)
  topDrawResults = []
  drawHeader()
  drawAnimals()
  // Pick 5 unique animals one by one with a 2s delay
  const picked = new Set<number>()
  for (let i = 0; i < 5; i++) {
    // pick a unique random index
    let idx: number
    do {
      idx = Math.floor(Math.random() * ANIMALS.length)
    } while (picked.has(idx))
    picked.add(idx)
  topDrawResults[i] = idx
  // Determine bonus: force first 3 as bonus when active, else 30% chance
  const isBonus = (forceTripleBonusRound && i < 3) ? true : (Math.random() < 0.30)
  topDrawBonusFlags[i] = isBonus
  drawHeader() // update boxes with new emoji
  // Fade in the emoji in the specific box for visual clarity
  fadeInTopBoxEmoji(i, idx, isBonus)
    // Increment reveal count and update per-ticket running wins
    revealCount = i + 1
    updateRunningWins()
    // Update cabinet prize to show current total win so far
    prizeAmount = tickets.reduce((sum, t) => sum + (t.win || 0), 0)
    drawCabinet()
    // Track consecutive bonus reveals; mark for popup if 3 in a row (deferred until round end)
    if (isBonus) {
      consecutiveBonusCount++
      bonusCountThisRound++
    } else {
      consecutiveBonusCount = 0
    }
    // Eligibility: any 3 or more bonus symbols across the 5 reveals
    if (bonusCountThisRound >= 3) {
      bonusEligibleThisRound = true
    }
    // wait 2 seconds
    await new Promise((res) => setTimeout(res, 2000))
  }
  // End auto draw: restore UI
  autoDrawActive = false
  // Animate tickets area back to original size
  animateTicketsTopLift(0)
  // Apply a final sort by win so highest prizes remain at the top
  sortTicketsByCurrentWin()
  // Ensure an empty ticket is available at the top when returning to selection
  tickets.splice(0, 0, { animals: [], confirmed: false, stake: undefined, win: 0 })
  // Finalize prizes based on the completed draw (running wins already reflect totals)
  prizeAmount = tickets.reduce((sum, t) => sum + (t.win || 0), 0)
  balance += prizeAmount
  // Clear reveal state so last round ticks disappear
  revealCount = 0
  drawHeader()
  drawAnimals()
  drawTicketsArea()
  drawCabinet()
  // After all calls have been made, show bonus popup once if eligible
  // If all five reveals are bonus, award Top Prize = 500x total confirmed stakes
  const allFiveBonus = topDrawBonusFlags.length === 5 && topDrawBonusFlags.every(Boolean)
  const bonusCount = topDrawBonusFlags.filter(Boolean).length
  if (bonusCount >= 4) {
    // Tiered bonus round ranges per request
    if (bonusCount === 5) {
      await showBonusGridRoundAndAward(5.0, 100.0, 5)
    } else {
      await showBonusGridRoundAndAward(2.0, 50.0, 5)
    }
  } else if (bonusEligibleThisRound) {
    // Base bonus round for 3+ bonus symbols
    await showBonusGridRoundAndAward(0.5, 25.0, 5)
  }
}

// Compute total prizes for all confirmed tickets based on topDrawResults
function computePrizesForAllTickets(): number {
  let total = 0
  const drawn = topDrawResults
  // Positions 1..5 mapping: drawn[0] is 1st, etc.
  for (const t of tickets) {
    if (!t.confirmed || !t.stake || t.animals.length === 0) continue
    const stake = t.stake
    const picks = t.animals
    // count exact position hits first
    let exactHits = 0
    for (let i = 0; i < Math.min(picks.length, drawn.length); i++) {
      if (picks[i] === drawn[i]) exactHits++
    }
    // count unordered hits (animals appearing anywhere in drawn)
    const drawnSet = new Set(drawn)
    let unorderedHits = 0
    for (const a of picks) if (drawnSet.has(a)) unorderedHits++
    // compute best payout by bet size
    let multiplier = 0
    switch (picks.length) {
      case 1:
        multiplier = exactHits === 1 ? 12 : (unorderedHits === 1 ? 3 : 0)
        break
      case 2:
        if (exactHits === 2) multiplier = 95
        else if (unorderedHits === 2) multiplier = 12
        else if (unorderedHits === 1) multiplier = 1
        else multiplier = 0
        break
      case 3:
        if (exactHits === 3) multiplier = 700
        else if (unorderedHits === 3) multiplier = 42
        else if (unorderedHits === 2) multiplier = 3
        else if (unorderedHits === 1) multiplier = 0.75
        else multiplier = 0
        break
      case 4:
        if (exactHits === 4) multiplier = 4000
        else if (unorderedHits === 4) multiplier = 500
        else if (unorderedHits === 3) multiplier = 22
        else if (unorderedHits === 2) multiplier = 1.5
        else if (unorderedHits === 1) multiplier = 0.2
        else multiplier = 0
        break
      case 5:
        if (exactHits === 5) multiplier = 17000
        else if (unorderedHits === 4) multiplier = 150
        else if (unorderedHits === 3) multiplier = 8
        else if (unorderedHits === 2) multiplier = 1
        else if (unorderedHits === 1) multiplier = 0.2
        else multiplier = 0
        break
    }
    total += stake * multiplier
  }
  return total
}

// Update per-ticket running wins based on current revealCount and topDrawResults
function updateRunningWins() {
  const revealed = topDrawResults.slice(0, revealCount)
  for (const t of tickets) {
    if (!t.confirmed || !t.stake || t.animals.length === 0) {
      t.win = 0
      continue
    }
    const stake = t.stake
    const picks = t.animals
    // exact hits among revealed positions
    let exactHits = 0
    for (let i = 0; i < Math.min(picks.length, revealed.length); i++) {
      if (picks[i] === revealed[i]) exactHits++
    }
    // unordered hits among revealed set
    const revSet = new Set(revealed)
    let unorderedHits = 0
    for (const a of picks) if (revSet.has(a)) unorderedHits++
    let multiplier = 0
    switch (picks.length) {
      case 1:
        multiplier = exactHits === 1 ? 12 : (unorderedHits === 1 ? 3 : 0)
        break
      case 2:
        if (exactHits === 2) multiplier = 95
        else if (unorderedHits === 2) multiplier = 12
        else if (unorderedHits === 1) multiplier = 1
        else multiplier = 0
        break
      case 3:
        if (exactHits === 3) multiplier = 700
        else if (unorderedHits === 3) multiplier = 42
        else if (unorderedHits === 2) multiplier = 3
        else if (unorderedHits === 1) multiplier = 0.75
        else multiplier = 0
        break
      case 4:
        if (exactHits === 4) multiplier = 4000
        else if (unorderedHits === 4) multiplier = 500
        else if (unorderedHits === 3) multiplier = 22
        else if (unorderedHits === 2) multiplier = 1.5
        else if (unorderedHits === 1) multiplier = 0.2
        else multiplier = 0
        break
      case 5:
        if (exactHits === 5) multiplier = 17000
        else if (unorderedHits === 4) multiplier = 150
        else if (unorderedHits === 3) multiplier = 8
        else if (unorderedHits === 2) multiplier = 1
        else if (unorderedHits === 1) multiplier = 0.2
        else multiplier = 0
        break
    }
    t.win = stake * multiplier
  }
  // During auto play, sort tickets by current win descending (top to bottom)
  if (autoDrawActive) {
    sortTicketsByCurrentWin()
  }
  // Refresh tickets to show ticks and running totals
  drawTicketsArea()
}

// Animate ticketsTopLift to a target value
function animateTicketsTopLift(target: number) {
  const start = ticketsTopLift
  const delta = target - start
  const duration = 1 // seconds
  let elapsed = 0
  const tick = (tkr: any) => {
    const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
    elapsed += dt / 60
    const t = Math.min(1, elapsed / duration)
    // ease-out
    const e = 1 - Math.pow(1 - t, 3)
    ticketsTopLift = start + delta * e
    drawTicketsArea()
    if (t >= 1) {
      app.ticker.remove(tick)
    }
  }
  app.ticker.add(tick)
}

// Helper: fade in text at the position of the i-th top box
function fadeInTopBoxEmoji(i: number, idx: number, bonusGlow = false) {
  // Match grid geometry for first row
  const cols = 5; const rows = 5
  const pad = 6
  const startY = 96
  const availableWidth = WIDTH - 16*2 - (cols - 1) * pad
  const ticketsViewportHeight = 165
  const availableHeight = (HEIGHT - CABINET_H - ticketsViewportHeight) - startY - (rows - 1) * pad
  const boxSize = Math.floor(Math.min(availableWidth / cols, availableHeight / rows))
  const x = 16 + i * (boxSize + pad)
  const y = startY
  const emoji = ANIMAL_EMOJI[ANIMALS[idx]] ?? '❓'
  // Optional golden glow behind the emoji (faded orange-yellow)
  let glow: Container | null = null
  if (bonusGlow) {
    glow = new Container()
    const cx = x + boxSize / 2
    const cy = y + boxSize / 2
    const rOuter = Math.floor(boxSize * 0.46)
    const rInner = Math.floor(boxSize * 0.34)
    // Outer soft orange layer
    const outer = new Graphics()
    outer.beginFill(0xffb300, 0.18)
    outer.drawCircle(cx, cy, rOuter)
    outer.endFill()
    // Inner pale yellow layer
    const inner = new Graphics()
    inner.beginFill(0xfff176, 0.35)
    inner.drawCircle(cx, cy, rInner)
    inner.endFill()
    glow.addChild(outer)
    glow.addChild(inner)
    glow.alpha = 0
    topDrawContainer.addChild(glow)
  }
  const txt = makeText(emoji, { fontSize: Math.floor(boxSize * 0.7) })
  txt.x = x + boxSize / 2 - txt.width / 2
  txt.y = y + boxSize / 2 - txt.height / 2
  txt.alpha = 0
  topDrawContainer.addChild(txt)
  // Animate alpha to 1 over ~0.3s
  let elapsed = 0
  const duration = 0.3
  const tick = (tkr: any) => {
    const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
    elapsed += dt / 60
    const t = Math.min(1, elapsed / duration)
  txt.alpha = t
  if (glow) glow.alpha = t * 0.7
    if (t >= 1) {
      app.ticker.remove(tick)
    }
  }
  app.ticker.add(tick)
}

// Simple modal popup for bonus round
function showBonusPopup(): Promise<void> {
  return new Promise((resolve) => {
    modalUI.removeChildren()
    // Backdrop
    const backdrop = new Graphics()
    backdrop.beginFill(0x000000, 1)
    backdrop.drawRect(0, 0, WIDTH, HEIGHT)
    backdrop.endFill()
    backdrop.alpha = 0
    modalUI.addChild(backdrop)

    // Panel
    const panelW = Math.min(320, WIDTH - 40)
    const panelH = 160
    const panelX = (WIDTH - panelW) / 2
    const panelY = (HEIGHT - panelH) / 2
    const panel = new Graphics()
    panel.beginFill(0x23272b)
    panel.drawRoundedRect(panelX, panelY, panelW, panelH, 10)
    panel.endFill()
    panel.lineStyle(2, ACCENT, 0.8)
    panel.drawRoundedRect(panelX, panelY, panelW, panelH, 10)
  modalUI.addChild(panel)

    const title = makeText('Bonus Round!', { fontSize: 22, fill: ACCENT })
    title.x = panelX + panelW / 2 - title.width / 2
    title.y = panelY + 14
    modalUI.addChild(title)

    const info = makeText('3 bonus animals in a row!', { fontSize: 16, fill: 0xcccccc })
    info.x = panelX + panelW / 2 - info.width / 2
    info.y = title.y + title.height + 8
    modalUI.addChild(info)

    // Close button
    const btnW = 100, btnH = 32
    const btnX = panelX + panelW / 2 - btnW / 2
    const btnY = panelY + panelH - btnH - 14
    const closeBtn = new Graphics()
    closeBtn.beginFill(0xc62828)
    closeBtn.drawRoundedRect(btnX, btnY, btnW, btnH, 6)
    closeBtn.endFill()
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    closeBtn.on('pointertap', () => {
      modalUI.removeChildren()
      resolve()
    })
    modalUI.addChild(closeBtn)

    const btnText = makeText('Close', { fontSize: 16, fill: 0xffffff })
    btnText.x = btnX + btnW / 2 - btnText.width / 2
    btnText.y = btnY + btnH / 2 - btnText.height / 2
    modalUI.addChild(btnText)

    // Fade in the blackout backdrop for clean transition
    let elapsed = 0
    const duration = 0.25
    const tick = (tkr: any) => {
      const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
      elapsed += dt / 60
      const t = Math.min(1, elapsed / duration)
      backdrop.alpha = 0.0 + 0.6 * t
      if (t >= 1) {
        app.ticker.remove(tick)
      }
    }
    app.ticker.add(tick)
  })
}

// Modal popup for Top Prize award
function showTopPrizePopup(amount: number): Promise<void> {
  return new Promise((resolve) => {
    modalUI.removeChildren()
    const backdrop = new Graphics()
    backdrop.beginFill(0x000000, 1)
    backdrop.drawRect(0, 0, WIDTH, HEIGHT)
    backdrop.endFill()
    backdrop.alpha = 0
    modalUI.addChild(backdrop)

    const panelW = Math.min(340, WIDTH - 40)
    const panelH = 180
    const panelX = (WIDTH - panelW) / 2
    const panelY = (HEIGHT - panelH) / 2
    const panel = new Graphics()
    panel.beginFill(0x23272b)
    panel.drawRoundedRect(panelX, panelY, panelW, panelH, 10)
    panel.endFill()
    panel.lineStyle(2, ACCENT, 0.8)
    panel.drawRoundedRect(panelX, panelY, panelW, panelH, 10)
    modalUI.addChild(panel)

    const title = makeText('Top Prize!', { fontSize: 24, fill: ACCENT })
    title.x = panelX + panelW / 2 - title.width / 2
    title.y = panelY + 12
    modalUI.addChild(title)

    const info = makeText('All 5 bonus symbols!', { fontSize: 16, fill: 0xcccccc })
    info.x = panelX + panelW / 2 - info.width / 2
    info.y = title.y + title.height + 6
    modalUI.addChild(info)

    const amtText = makeText(`Awarded: £${amount.toFixed(2)}`, { fontSize: 18, fill: 0xffffff })
    amtText.x = panelX + panelW / 2 - amtText.width / 2
    amtText.y = info.y + info.height + 8
    modalUI.addChild(amtText)

    const btnW = 110, btnH = 34
    const btnX = panelX + panelW / 2 - btnW / 2
    const btnY = panelY + panelH - btnH - 14
    const closeBtn = new Graphics()
    closeBtn.beginFill(0xc62828)
    closeBtn.drawRoundedRect(btnX, btnY, btnW, btnH, 6)
    closeBtn.endFill()
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    closeBtn.on('pointertap', () => {
      modalUI.removeChildren()
      resolve()
    })
    modalUI.addChild(closeBtn)

    const btnText = makeText('Close', { fontSize: 16, fill: 0xffffff })
    btnText.x = btnX + btnW / 2 - btnText.width / 2
    btnText.y = btnY + btnH / 2 - btnText.height / 2
    modalUI.addChild(btnText)

    // Fade-in backdrop
    let elapsed = 0
    const duration = 0.25
    const tick = (tkr: any) => {
      const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
      elapsed += dt / 60
      const t = Math.min(1, elapsed / duration)
      backdrop.alpha = 0.0 + 0.6 * t
      if (t >= 1) app.ticker.remove(tick)
    }
    app.ticker.add(tick)
  })
}

// Bonus round: hidden 5x5 grid with random multipliers; player gets 5 picks, then award total
function showBonusGridRoundAndAward(minMultiplier = 0.5, maxMultiplier = 25.0, picks = 5, stakeOverrideAmount?: number): Promise<void> {
  return new Promise((resolve) => {
    modalUI.removeChildren()
    // Backdrop with fade-in
    const backdrop = new Graphics()
    backdrop.beginFill(0x000000, 1)
    backdrop.drawRect(0, 0, WIDTH, HEIGHT)
    backdrop.endFill()
    backdrop.alpha = 0
  modalUI.addChild(backdrop)

    // Panel container
    const panel = new Container()
    modalUI.addChild(panel)
    const panelW = Math.min(420, WIDTH - 20)
    const panelH = Math.min(560, HEIGHT - 40)
    const panelX = (WIDTH - panelW) / 2
    const panelY = (HEIGHT - panelH) / 2
    const panelBg = new Graphics()
    panelBg.beginFill(0x23272b)
    panelBg.drawRoundedRect(panelX, panelY, panelW, panelH, 12)
    panelBg.endFill()
    panelBg.lineStyle(2, ACCENT, 0.8)
    panelBg.drawRoundedRect(panelX, panelY, panelW, panelH, 12)
    panel.addChild(panelBg)

  const title = makeText('Bonus Round', { fontSize: 22, fill: ACCENT })
    title.x = panelX + panelW / 2 - title.width / 2
    title.y = panelY + 12
    panel.addChild(title)

  const info = makeText(`Pick ${picks} tiles!`, { fontSize: 16, fill: 0xcccccc })
    info.x = panelX + panelW / 2 - info.width / 2
    info.y = title.y + title.height + 6
    panel.addChild(info)

    // Grid dimensions
    const rows = 5, cols = 5
    const pad = 6
    const gridW = panelW - 24
    const gridH = panelH - 140
    const tileSize = Math.floor(Math.min((gridW - (cols - 1) * pad) / cols, (gridH - (rows - 1) * pad) / rows))
    const startX = panelX + 12
    const startY = info.y + info.height + 12

    // Generate random multipliers in provided range as whole integers
    const minInt = Math.ceil(minMultiplier)
    const maxInt = Math.floor(maxMultiplier)
    const multipliers: number[] = Array(rows * cols).fill(0).map(() => {
      const raw = minInt + Math.random() * (maxInt - minInt)
      return Math.round(raw)
    })
    const revealed: boolean[] = Array(rows * cols).fill(false)
  let picksLeft = picks
    let totalMultiplier = 0

    const picksLabel = makeText(`Picks: ${picksLeft}`, { fontSize: 16, fill: 0xffffff })
    picksLabel.x = panelX + 16
    picksLabel.y = panelY + panelH - 40
    panel.addChild(picksLabel)

  const totalLabel = makeText(`Total: ${Math.round(totalMultiplier)}x`, { fontSize: 16, fill: 0xffffff })
    totalLabel.x = panelX + panelW - totalLabel.width - 16
    totalLabel.y = panelY + panelH - 40
    panel.addChild(totalLabel)

    // Build grid of tiles
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const x = startX + c * (tileSize + pad)
        const y = startY + r * (tileSize + pad)
        const cover = new Graphics()
        cover.beginFill(0x1b1f23)
        cover.drawRoundedRect(x, y, tileSize, tileSize, 8)
        cover.endFill()
        cover.lineStyle(2, 0x3a4046, 0.9)
        cover.drawRoundedRect(x, y, tileSize, tileSize, 8)
        cover.eventMode = 'static'
        cover.cursor = 'pointer'
        cover.on('pointertap', () => {
          if (revealed[i] || picksLeft <= 0) return
          revealed[i] = true
          picksLeft -= 1
          const mult = multipliers[i]
          totalMultiplier += mult
          // Reveal visual
          cover.clear()
          cover.beginFill(0x263238)
          cover.drawRoundedRect(x, y, tileSize, tileSize, 8)
          cover.endFill()
          cover.lineStyle(2, ACCENT, 0.9)
          cover.drawRoundedRect(x, y, tileSize, tileSize, 8)
          const emoji = ANIMAL_EMOJI[ANIMALS[i % ANIMALS.length]] ?? '❓'
          const txt = makeText(emoji, { fontSize: Math.floor(tileSize * 0.6) })
          txt.x = x + tileSize / 2 - txt.width / 2
          txt.y = y + tileSize / 2 - txt.height / 2 - 8
          panel.addChild(txt)
          const multText = makeText(`${Math.round(mult)}x`, { fontSize: 16, fill: 0xfff176 })
          multText.x = x + tileSize / 2 - multText.width / 2
          multText.y = y + tileSize - multText.height - 6
          panel.addChild(multText)

          // Update labels
          picksLabel.text = `Picks: ${picksLeft}`
          totalLabel.text = `Total: ${Math.round(totalMultiplier)}x`
          totalLabel.x = panelX + panelW - totalLabel.width - 16

          // If done, award
          if (picksLeft === 0) {
            // Award prize = totalMultiplier * total confirmed stakes
            const totalConfirmedStakes = (typeof stakeOverrideAmount === 'number')
              ? stakeOverrideAmount
              : tickets.reduce((sum, t) => sum + ((t.confirmed && t.stake) ? t.stake : 0), 0)
            const bonusPrize = totalConfirmedStakes * totalMultiplier
            prizeAmount += bonusPrize
            balance += bonusPrize
            drawCabinet()
            // Close modal after brief delay for feedback
            setTimeout(() => {
              modalUI.removeChildren()
              resolve()
            }, 300)
          }
        })
        panel.addChild(cover)
      }
    }

    // Fade-in backdrop
    let elapsed = 0
    const duration = 0.25
    const tick = (tkr: any) => {
      const dt = (tkr && typeof tkr.deltaTime === 'number') ? tkr.deltaTime : 1
      elapsed += dt / 60
      const t = Math.min(1, elapsed / duration)
      backdrop.alpha = 0.0 + 0.6 * t
      if (t >= 1) app.ticker.remove(tick)
    }
    app.ticker.add(tick)
  })
}

function drawCabinet() {
  cabinetUI.removeChildren()

  // Cabinet background and divider
  const cabBg = new Graphics()
  cabBg.beginFill(0x1b1f23)
  cabBg.drawRect(0, HEIGHT - CABINET_H, WIDTH, CABINET_H)
  cabBg.endFill()
  // top divider line
  cabBg.lineStyle(2, ACCENT, 0.6)
  cabBg.moveTo(0, HEIGHT - CABINET_H)
  cabBg.lineTo(WIDTH, HEIGHT - CABINET_H)
  cabinetUI.addChild(cabBg)

  // Balance capsule positioned to the left of the minus button
  const controlsCenterY = HEIGHT - CABINET_H + (CABINET_H / 2)
  const controlsCenterX = WIDTH / 2
    const minusX = controlsCenterX - 60
    const capsulePaddingX = 12
    const capsulePaddingY = 12
    const capsuleHeight = 28
    // Fixed capsule width; text will resize to fit
    const capsuleWidth = 145
    // Format balance to two decimals or fewer by trimming trailing zeros
    const balNumStr = Number(balance).toFixed(2).replace(/\.00$/, '.0').replace(/\.([0-9])0$/, '.$1').replace(/\.0$/, '')
    const balText = makeText(`Balance: £${balNumStr}`, { fontSize: 18 })
  const gap = 10
  const capsuleX = minusX - gap - capsuleWidth
  const capsuleY = HEIGHT - CABINET_H + (CABINET_H / 2) - capsuleHeight / 2
  const balCapsule = new Graphics()
  balCapsule.beginFill(0x23272b)
  balCapsule.drawRoundedRect(capsuleX, capsuleY, capsuleWidth, capsuleHeight, capsuleHeight / 2)
  balCapsule.endFill()
  // subtle border
  balCapsule.lineStyle(2, ACCENT, 0.5)
  balCapsule.drawRoundedRect(capsuleX, capsuleY, capsuleWidth, capsuleHeight, capsuleHeight / 2)
  cabinetUI.addChild(balCapsule)
  // Auto-resize text to fit fixed capsule width (account for padding)
  const maxTextWidth = capsuleWidth - capsulePaddingX * 2
  let fontSize = 18
  // Decrease font size until it fits or a minimum
  while (balText.width > maxTextWidth && fontSize > 10) {
    fontSize -= 1
    balText.style.fontSize = fontSize
  }
  balText.x = capsuleX + capsuleWidth / 2 - balText.width / 2
  balText.y = capsuleY + capsuleHeight / 2 - balText.height / 2
  cabinetUI.addChild(balText)

  // Mirrored prize capsule to the right of the plus button
  const plusX = controlsCenterX + 45
  const prizeCapsuleWidth = 144
  const prizeCapsuleHeight = 28
  const prizeGap = 10
  const prizeCapsuleX = plusX + prizeGap + 15
  const prizeCapsuleY = HEIGHT - CABINET_H + (CABINET_H / 2) - prizeCapsuleHeight / 2
  const prizeCapsule = new Graphics()
  prizeCapsule.beginFill(0x23272b)
  prizeCapsule.drawRoundedRect(prizeCapsuleX, prizeCapsuleY, prizeCapsuleWidth, prizeCapsuleHeight, prizeCapsuleHeight / 2)
  prizeCapsule.endFill()
  prizeCapsule.lineStyle(2, ACCENT, 0.5)
  prizeCapsule.drawRoundedRect(prizeCapsuleX, prizeCapsuleY, prizeCapsuleWidth, prizeCapsuleHeight, prizeCapsuleHeight / 2)
  cabinetUI.addChild(prizeCapsule)
  const prizeTextRaw = `Prize: £${prizeAmount.toFixed(2)}`
  let prizeFontSize = 18
  const prizeText = makeText(prizeTextRaw, { fontSize: prizeFontSize })
  const maxPrizeTextWidth = prizeCapsuleWidth - capsulePaddingX * 2
  while (prizeText.width > maxPrizeTextWidth && prizeFontSize > 10) {
    prizeFontSize -= 1
    prizeText.style.fontSize = prizeFontSize
  }
  prizeText.x = prizeCapsuleX + prizeCapsuleWidth / 2 - prizeText.width / 2
  prizeText.y = prizeCapsuleY + prizeCapsuleHeight / 2 - prizeText.height / 2
  cabinetUI.addChild(prizeText)

  // Stake controls: round [-] amount [+], cycling the stake
  // stake buttons positioned around center (minus/plus adjusted separately)
  const minusBtn = makeRoundButton('−', controlsCenterX - 45, controlsCenterY, 16, () => {
    selectedStakeIndex = Math.max(0, selectedStakeIndex - 1)
    // Redraw both cabinet and tickets to reflect stake-limit messages on empty ticket
    drawCabinet()
    drawTicketsArea()
  })
  const plusBtn = makeRoundButton('+', controlsCenterX + 45, controlsCenterY, 16, () => {
    selectedStakeIndex = Math.min(STAKES.length - 1, selectedStakeIndex + 1)
    // Redraw both cabinet and tickets to reflect stake-limit messages on empty ticket
    drawCabinet()
    drawTicketsArea()
  })
  cabinetUI.addChild(minusBtn)
  cabinetUI.addChild(plusBtn)
  const currentStakeLabel = STAKES[selectedStakeIndex] >= 1
    ? `£${STAKES[selectedStakeIndex].toFixed(2)}`
    : `${Math.round(STAKES[selectedStakeIndex] * 100)}p`
  // Determine if Play is enabled (requires at least one confirmed ticket)
  const playEnabled = tickets.some(t => t.confirmed)
  // Draw a larger red circular background for the stake amount (Play button)
  const stakeBgRadius = 24
  const stakeBg = new Graphics()
  stakeBg.beginFill(playEnabled ? 0xc62828 : 0x5a5e62)
  stakeBg.drawCircle(controlsCenterX, controlsCenterY, stakeBgRadius)
  stakeBg.endFill()
  // Make the red circle act like the Play button (only when enabled)
  stakeBg.eventMode = playEnabled ? 'static' : 'none'
  stakeBg.cursor = playEnabled ? 'pointer' : 'default'
  if (playEnabled) {
    stakeBg.on('pointertap', () => {
      startAutoDraw()
    })
    // Simple hover feedback: slightly brighter red
    stakeBg.on('pointerover', () => {
      stakeBg.clear()
      stakeBg.beginFill(0xd93a3a)
      stakeBg.drawCircle(controlsCenterX, controlsCenterY, stakeBgRadius)
      stakeBg.endFill()
    })
    stakeBg.on('pointerout', () => {
      stakeBg.clear()
      stakeBg.beginFill(0xc62828)
      stakeBg.drawCircle(controlsCenterX, controlsCenterY, stakeBgRadius)
      stakeBg.endFill()
    })
  }
  cabinetUI.addChild(stakeBg)
  // Amount text centered within the red circle
  const amountText = makeText(currentStakeLabel, { fontSize: 20, fill: playEnabled ? 0xffffff : 0xcfd3d7 })
  amountText.x = controlsCenterX - amountText.width / 2
  amountText.y = controlsCenterY - amountText.height / 2
  cabinetUI.addChild(amountText)

  // Play and Reset buttons
  // Temporarily hidden per request

  // Ticket controls are now inline on each ticket row (✓ and ✕ icons)
}

function layoutAndDraw() {
  drawHeader()
  drawAnimals()
  // Add tickets to stage and draw
  app.stage.addChild(ticketsContainer)
  app.stage.addChild(ticketsMask)
  // Ensure zIndex is maintained
  ticketsContainer.zIndex = 30
  overlay.zIndex = 40
  cabinetUI.zIndex = 50
  drawTicketsArea()
  drawCabinet()
}

// Scroll handling for tickets viewport (mouse wheel)
document.addEventListener('wheel', (e) => {
    const baseSlotSize = 34
    const slotSize = Math.floor(baseSlotSize * 1.5)
    const rowPad = 12
    const viewportH = 165
    const maxContentH = tickets.length * (slotSize + rowPad + 24)
    const maxScroll = Math.max(0, maxContentH - viewportH)
    const delta = Math.sign((e as WheelEvent).deltaY) * 20
    ticketsScrollY = Math.min(0, Math.max(-maxScroll, ticketsScrollY - delta))
    drawTicketsArea()
})

// Global pulse state
const ticketPulse: Map<number, number> = new Map()
let needsNewTicket = false

// Initialize application
initApp()

function sortTicketsByCurrentWin() {
  if (tickets.length === 0) return
  const empties = [] as Ticket[]
  const nonEmpties = [] as Ticket[]
  for (const t of tickets) {
    if (!t.confirmed && t.animals.length === 0) empties.push(t)
    else nonEmpties.push(t)
  }
  nonEmpties.sort((a, b) => {
    const winDiff = (b.win || 0) - (a.win || 0)
    if (winDiff !== 0) return winDiff
    const stakeDiff = ((b.stake || 0) - (a.stake || 0))
    if (stakeDiff !== 0) return stakeDiff
    return b.animals.length - a.animals.length
  })
  tickets.length = 0
  for (const t of empties) tickets.push(t)
  for (const t of nonEmpties) tickets.push(t)
}
