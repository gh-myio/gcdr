# PATCH — GCDR Alarms Simulator (UI/UX + Scenario Builder)

## Context
The current simulator experience is not intuitive enough and does not clearly represent
how alarm scenarios are configured, driven, and executed.

This patch introduces:
- A structured 2x3 visual layout for the simulator
- A scenario-driven approach
- A full-screen Scenario Builder (wizard)
- Explicit simulation control modes

The goal is to transform the simulator into a **clear, explainable, and controllable environment**
for alarm behavior testing.

---

## Simulator Layout (High Level)

The simulator UI must be organized as a **fixed grid with 2 rows and 3 columns**:
Row 1: [ Block 1 ] [ Block 2 ] [ Block 3 ]
Row 2: [ Block 4 ] [ Block 5 ] [ Block 6 ]


Each block represents a clear stage in the alarm lifecycle.

---

## Block 1 — Scenario Overview (Row 1 / Column 1)

### Purpose
Block 1 acts as a **summary and control center** for the simulation scenario.

It must answer:
> "What exactly am I about to simulate?"

This block **does not perform detailed configuration**.
It only summarizes the current scenario and exposes the main actions.

---

### Block 1 — UI Requirements

Displayed information:
- Number of Centrals
- Devices per Central
- Selected Device Types
- Selected Rules
- Simulation Mode
- Current Status (Not configured / Ready / Running)

Primary action:
- **Configure Simulator** (main CTA)

Secondary action:
- **Start Simulation** (disabled until scenario is created)

---

### Block 1 — Behavior

Initial state:
- No scenario configured
- Only "Configure Simulator" button is enabled
- "Start Simulation" is disabled

After scenario creation:
- Summary is populated
- Status changes to `Ready`
- "Start Simulation" becomes enabled
- "Configure Simulator" becomes "Reconfigure Simulator"

---

## Scenario Builder — Full Screen Modal

### General Rules
- Opens as **full-screen modal**
- Implemented as a **step-based wizard**
- User cannot start simulation without completing the wizard
- Wizard must validate configuration before final creation

---

## Wizard Steps Overview
Step 1 → Centrals
Step 2 → Devices
Step 3 → Rules
Step 4 → Simulation Control
Step 5 → Review & Create

Step 1 → Centrals
Step 2 → Devices
Step 3 → Rules
Step 4 → Simulation Control
Step 5 → Review & Create
