# Product Overview

## Summary

Insider Risk Monitor - an internal-security MVP that ingests security-relevant logs, normalizes events, computes explainable risk scores using simple rules + baselines, and displays alerts in a triage-focused dashboard.

## Purpose

Detect and surface insider risk indicators from existing security telemetry (app logs, VPN logs, IAM/API logs, file access logs) with full explainability and privacy controls.

## Key Features

- Ingestion API with per-source API keys
- Event normalization into common schema
- Baseline + rule-based scoring engine (rolling windows)
- Alerts generated from risk thresholds
- Dashboard UI: Overview, Alerts list, Actor profile (timeline), Rules config, Sources
- Seed + demo data generator

## Non-Negotiables

- **No spyware**: No keylogging, screenshots, microphone/camera capture, clipboard capture
- **Existing telemetry only**: Use security data companies already generate
- **Explainability over ML**: Rules must be inspectable and adjustable
- **Privacy controls**: Data minimization, optional redaction, retention settings

## Target Users

Internal security teams triaging potential insider risk incidents.

## Risk Score Requirements

All risk scores must include:
- Total score 0–100
- Rule contributions (e.g., "New IP +15, Off-hours +10, Volume spike +20")
- Baseline values used (e.g., typical active hours, normal download size)

## Decision Rules

- If ambiguity exists, choose the simplest assumption that enables a demo
- Prefer deterministic and explainable heuristics over probabilistic models
- Keep UI triage-first (alerts, reasons, actor context) rather than analytics-heavy
