# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Open File Command for Macros**: New macro command that allows opening existing files with formatted paths like `{{DATE}}todo.md`, `notes/{{VALUE}}.md`, etc. Supports all QuickAdd formatting syntax and includes configuration options for new tab behavior, split direction, focus, and view mode. (#159)

### Security
- Added path traversal validation to prevent opening files outside the vault using ".." in paths
