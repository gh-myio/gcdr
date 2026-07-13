MYIO Store Dashboard MVP Specification
Version 1.0
Document Type: Product Requirement + UI/UX Specification
Language: English
1. Overview

The purpose of this dashboard is to provide a single-store operational view for restaurants, supermarkets, gyms, pharmacies, hospitals, retail stores, and similar environments.

Unlike shopping center dashboards, where the objective is to understand consumption distribution across tenants and infrastructure, this dashboard focuses on:

Operational health
Utility consumption
Equipment performance
Predictive insights
Cost optimization

The platform must answer a simple question:

"Is my store operating efficiently right now?"

2. Design Philosophy

The design language should remain visually aligned with the existing MYIO Shopping Center dashboard:

White background
Rounded cards
Purple as primary accent color (#6C3CF0)
Soft shadows
Small sparkline charts
Light gray separators
Dense information layout
Operational control room feeling

Visual inspiration:

Tesla Energy
Google Nest
Datadog Infrastructure
Apple Home
Stripe Dashboard
3. Layout Structure
┌───────────────────────────────────────────────────────────┐
│ Header                                                    │
├──────────────┬───────────────────────────────┬────────────┤
│ Left Menu    │ Main Operational Area         │ Insights   │
│              │                               │ Sidebar    │
│              │                               │            │
└──────────────┴───────────────────────────────┴────────────┘
4. Left Navigation Menu
Fixed Menu Items
Dashboard

Main operational overview.

Icon:

🏠
Insights

AI generated recommendations and opportunities.

Icon:

✨

Examples:

HVAC consuming 18% above expected baseline.
Water leak suspected during closed hours.
Freezer operating outside recommended range.
Energy cost can be reduced by changing startup sequence.
Alerts

Operational alarms.

Icon:

🚨

Examples:

Freezer temperature high.
Tank level low.
Excessive water consumption.
Sensor communication failure.
Reports

Historical reports and exports.

Icon:

📊
Performance

KPIs and benchmarking.

Icon:

📈
Settings

Store configuration.

Icon:

⚙️
5. Header Area
Components
Store selector

Example:

Steak House Prime
Store 001 · Leblon · RJ
Date Range Selector

Examples:

Today
Yesterday
Last 7 Days
Last 30 Days
Current Month
Custom Range
Notification Center

Badge counter.

User Avatar
6. Main Dashboard Area

The center of the dashboard contains four major operational groups.

Group 1 — Energy

Color:

Purple

Icon:

⚡

Purpose:

Electrical consumption and distribution.

Summary Card

Displays:

Current demand
Daily consumption
Monthly consumption
Peak demand
Cost estimate
Equipment Cards Examples
Main Panel

Fields:

Current Power
Consumption Today
Status
Alarm Count
Kitchen Circuit

Fields:

Current Load
Consumption Today
Percentage of total
HVAC

Fields:

Current Demand
Runtime
Consumption
Lighting

Fields:

Current Consumption
Estimated Cost
Refrigeration

Fields:

Compressor status
Consumption
Group 2 — Water

Color:

Blue

Icon:

💧

Purpose:

Water monitoring.

Summary Card

Displays:

Current flow
Daily consumption
Monthly consumption
Estimated cost
Device Cards Examples
Main Meter
Kitchen Water
Restrooms
Irrigation
Cleaning Area

Each card displays:

Flow rate
Daily volume
Monthly volume
Alarm status
Group 3 — Temperature

Color:

Green

Icon:

🌡️

Purpose:

Environmental and equipment temperatures.

Summary Card

Displays:

Average temperature
Number of sensors online
Out-of-range sensors
Device Cards Examples
Dining Room
Kitchen
Freezer
Cold Chamber
Wine Cellar
HVAC Supply Air

Each card displays:

Current temperature
Min/Max range
Trend
Alarm state
Group 4 — Reservoirs and Water Tanks

Color:

Cyan

Icon:

🛢️

Purpose:

Water storage management.

Summary Card

Displays:

Average fill level
Estimated autonomy
Pumps online
Device Cards Examples
Upper Tank
Lower Tank
Kitchen Tank
Fire Reserve Tank
Pressure System

Fields:

Current level
Capacity
Percentage
Estimated remaining hours
Pump state
7. Insights Module

This is the feature that creates differentiation.

The menu item should exist independently.

Insight Types
Energy Optimization

Example:

HVAC startup can be delayed by 20 minutes and save 8%.

Water Leak Detection

Example:

Continuous flow detected between 02:00 and 05:00.

Refrigeration Efficiency

Example:

Freezer #2 compressor runtime increased by 35%.

Tank Management

Example:

Upper tank refill cycle frequency increased by 28%.

Predictive Maintenance

Example:

HVAC compressor vibration pattern indicates possible maintenance requirement within 30 days.

Operational Recommendations

Example:

Kitchen equipment startup sequence could reduce peak demand charges.

8. Insights Page Layout
┌──────────────────────────────┐
│ Savings Opportunities        │
├──────────────────────────────┤
│ Predictive Maintenance        │
├──────────────────────────────┤
│ Consumption Anomalies         │
├──────────────────────────────┤
│ Benchmark Comparison          │
└──────────────────────────────┘
9. Right Sidebar
Operational Health Score

Example:

92/100
Active Alerts

Examples:

Freezer High Temperature
Low Water Level
Top Consumers

Examples:

HVAC
Kitchen Circuit
Refrigeration
Monthly Goal Progress

Example:

Energy Goal:
78%
AI Recommendation Counter

Example:

5 recommendations available
10. Card Actions

Every device card supports:

Real Time Graph
Historical Graph
Reports
Alarms
Configuration
Maintenance History

Icons:

📈
📋
🚨
⚙️
🔧
11. Future Features
Carbon footprint tracking
Utility billing prediction
Occupancy correlation
Weather correlation
Multi-store benchmarking
Digital Twin Mode
Equipment health score
AI assistant integration
12. MVP Goal

The MVP should make a store manager able to answer within 30 seconds:

Is everything working?
Where am I spending money?
Is there any risk?
Can I save money?
What requires attention now?