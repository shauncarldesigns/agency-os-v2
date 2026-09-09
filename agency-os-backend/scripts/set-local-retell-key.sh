#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.dev.vars"

printf '\nAgency OS — Local Retell Setup\n'
printf 'This saves the key only in agency-os-backend/.dev.vars.\n\n'
IFS= read -r -s -p 'Paste Retell API key (hidden), then press Enter: ' RETELL_KEY
printf '\n'

if [[ -z "${RETELL_KEY}" ]]; then
  printf 'No key entered. Nothing changed.\n'
  exit 1
fi

ESCAPED_KEY=${RETELL_KEY//\\/\\\\}
ESCAPED_KEY=${ESCAPED_KEY//\"/\\\"}
TEMP_FILE="$(mktemp "${TMPDIR:-/tmp}/agency-os-retell.XXXXXX")"
FOUND=0

if [[ -f "${ENV_FILE}" ]]; then
  while IFS= read -r LINE || [[ -n "${LINE}" ]]; do
    if [[ "${LINE}" == RETELL_API_KEY=* ]]; then
      printf 'RETELL_API_KEY="%s"\n' "${ESCAPED_KEY}" >> "${TEMP_FILE}"
      FOUND=1
    else
      printf '%s\n' "${LINE}" >> "${TEMP_FILE}"
    fi
  done < "${ENV_FILE}"
fi

if [[ "${FOUND}" -eq 0 ]]; then
  printf '\nRETELL_API_KEY="%s"\n' "${ESCAPED_KEY}" >> "${TEMP_FILE}"
fi

chmod 600 "${TEMP_FILE}"
mv "${TEMP_FILE}" "${ENV_FILE}"
unset RETELL_KEY ESCAPED_KEY
printf 'Saved locally. You can close this window and return to Codex.\n'
printf 'Press Enter to close. '
IFS= read -r
