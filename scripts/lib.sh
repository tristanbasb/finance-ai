#!/usr/bin/env bash
# Fonctions communes à install.sh, update.sh et scripts/set-password.sh.
# Ce fichier est sourcé (pas exécuté) ; le script appelant active `set -euo pipefail`.
# shellcheck shell=bash

# Les erreurs dans $(…) interrompent aussi le script (bash ≥ 4.4).
shopt -s inherit_errexit 2>/dev/null || true

# ---------------------------------------------------------------------------
# Affichage
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_BLUE=$'\033[34m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET='' C_BOLD='' C_BLUE='' C_GREEN='' C_YELLOW='' C_RED=''
fi

info() { printf '%s==>%s %s\n' "$C_BLUE$C_BOLD" "$C_RESET" "$*"; }
ok() { printf '%s ✓ %s %s\n' "$C_GREEN$C_BOLD" "$C_RESET" "$*"; }
warn() { printf '%s ! %s %s\n' "$C_YELLOW$C_BOLD" "$C_RESET" "$*" >&2; }
die() {
  printf '%s ✗ %s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2
  exit 1
}
bold() { printf '%s%s%s' "$C_BOLD" "$*" "$C_RESET"; }

# ---------------------------------------------------------------------------
# Entrées utilisateur (lues sur le terminal, même si stdin est un tube : curl … | bash)
# ---------------------------------------------------------------------------
if { exec 3</dev/tty; } 2>/dev/null; then
  HAS_TTY=1
else
  HAS_TTY=0
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# non_interactive → 0 si aucune question ne doit être posée (FINANCE_AI_YES=1 ou pas de terminal).
non_interactive() {
  [ "${FINANCE_AI_YES:-0}" = "1" ] || [ "$HAS_TTY" != "1" ]
}

# confirm "Question ?" → 0 si oui. FINANCE_AI_YES=1 répond oui automatiquement.
confirm() {
  local answer
  if [ "${FINANCE_AI_YES:-0}" = "1" ]; then
    info "$1 [o/N] o (FINANCE_AI_YES=1)"
    return 0
  fi
  [ "$HAS_TTY" = "1" ] || die "Pas de terminal pour répondre à : « $1 ». Relancez avec FINANCE_AI_YES=1."
  printf '%s [o/N] ' "$1" >&2
  read -r answer <&3 || answer=""
  case "$answer" in
    [oOyY] | [oO][uU][iI] | [yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# ask "Question" "défaut" → imprime la réponse (ou le défaut si vide, ou en mode non interactif).
ask() {
  local answer
  ! non_interactive || {
    printf '%s\n' "$2"
    return 0
  }
  printf '%s [%s] : ' "$1" "$2" >&2
  read -r answer <&3 || answer=""
  printf '%s\n' "${answer:-$2}"
}

# ask_secret "Question" → imprime la saisie masquée (rien n'est affiché à l'écran), espaces compris.
ask_secret() {
  local answer
  ! non_interactive || die "Mode non interactif : impossible de demander « $1 »."
  printf '%s : ' "$1" >&2
  IFS= read -r -s answer <&3 || answer=""
  printf '\n' >&2
  printf '%s' "$answer"
}

# read_new_password → imprime le nouveau mot de passe (FINANCE_AI_PASSWORD ou double saisie).
read_new_password() {
  local pw pw2
  if [ -n "${FINANCE_AI_PASSWORD:-}" ]; then
    pw="$FINANCE_AI_PASSWORD"
    [ "${#pw}" -ge 8 ] || die "FINANCE_AI_PASSWORD doit contenir au moins 8 caractères."
    [ "${#pw}" -le 1024 ] || die "FINANCE_AI_PASSWORD ne doit pas dépasser 1024 caractères."
    printf '%s' "$pw"
    return 0
  fi
  ! non_interactive || die "Mode non interactif (FINANCE_AI_YES=1 ou pas de terminal) : définissez FINANCE_AI_PASSWORD."
  while true; do
    pw="$(ask_secret "Mot de passe de connexion (8 caractères minimum)")"
    if [ "${#pw}" -lt 8 ]; then
      warn "Trop court : 8 caractères minimum."
      continue
    fi
    if [ "${#pw}" -gt 1024 ]; then
      warn "Trop long : 1024 caractères maximum."
      continue
    fi
    pw2="$(ask_secret "Confirmez le mot de passe")"
    if [ "$pw" != "$pw2" ]; then
      warn "Les deux saisies ne correspondent pas, recommencez."
      continue
    fi
    printf '%s' "$pw"
    return 0
  done
}

# ---------------------------------------------------------------------------
# Privilèges et Docker
# ---------------------------------------------------------------------------
# SUDO : « sudo » si l'on n'est pas root et que sudo existe, vide sinon.
SUDO=""
if [ "$(id -u)" -ne 0 ] && need_cmd sudo; then
  SUDO="sudo"
fi

# as_root <commande…> : exécute en root (directement si déjà root, sinon via sudo).
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif [ -n "$SUDO" ]; then
    sudo "$@"
  else
    die "Droits administrateur requis pour : $* (relancez en root ou installez sudo)."
  fi
}

# DOCKER : préfixe des commandes docker (sudo si l'utilisateur n'a pas accès au socket).
DOCKER=(docker)
COMPOSE=()

# detect_docker → 0 si le démon est joignable (directement ou via sudo) ; règle DOCKER.
detect_docker() {
  need_cmd docker || return 1
  if docker info >/dev/null 2>&1; then
    DOCKER=(docker)
    return 0
  fi
  if [ -n "$SUDO" ] && sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
    warn "Docker nécessite sudo pour cet utilisateur : les commandes docker seront lancées avec sudo."
    return 0
  fi
  return 1
}

# detect_compose → règle COMPOSE (docker compose ou docker-compose).
detect_compose() {
  if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
    COMPOSE=("${DOCKER[@]}" compose)
  elif need_cmd docker-compose; then
    if [ "${DOCKER[0]}" = "docker" ]; then
      COMPOSE=(docker-compose)
    else
      COMPOSE=(sudo docker-compose)
    fi
  else
    return 1
  fi
}

docker_cmd() { "${DOCKER[@]}" "$@"; }
compose() { "${COMPOSE[@]}" "$@"; }

# require_docker : Docker + compose obligatoires (update.sh, set-password.sh).
require_docker() {
  detect_docker || die "Docker est introuvable ou son démon ne répond pas. Lancez d'abord ./install.sh."
  detect_compose || die "Docker Compose est introuvable (paquet docker-compose-plugin)."
}

IMAGE="finance-ai:latest"

# app_container_id → identifiant du conteneur de l'app (vide s'il n'existe pas).
app_container_id() {
  compose ps -q app 2>/dev/null | head -n 1
}

# app_running → 0 si le conteneur de l'app tourne.
app_running() {
  local id
  id="$(app_container_id)"
  [ -n "$id" ] && [ "$(docker_cmd inspect -f '{{.State.Running}}' "$id" 2>/dev/null)" = "true" ]
}

# wait_healthy <timeout en secondes> → 0 dès que l'app répond (healthcheck Docker ou /api/health).
wait_healthy() {
  local timeout="$1" port id status elapsed=0
  port="$(env_get APP_PORT)"
  port="${port:-3000}"
  info "Attente du démarrage de l'application (${timeout} s max)…"
  while [ "$elapsed" -lt "$timeout" ]; do
    id="$(app_container_id)"
    if [ -n "$id" ]; then
      status="$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)"
      case "$status" in
        healthy)
          ok "Application en bonne santé."
          return 0
          ;;
        unhealthy)
          warn "Le healthcheck Docker signale l'application comme défaillante."
          return 1
          ;;
      esac
    fi
    if need_cmd curl && curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:${port}/api/health" 2>/dev/null; then
      ok "Application en ligne (/api/health répond)."
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  warn "L'application ne répond toujours pas après ${timeout} s."
  return 1
}

# ---------------------------------------------------------------------------
# Fichier .env
# ---------------------------------------------------------------------------

# env_get KEY [fichier] → valeur de KEY dans .env (vide si absente).
env_get() {
  local file="${2:-.env}"
  [ -f "$file" ] || return 0
  awk -v key="$1" 'index($0, key "=") == 1 { val = substr($0, length(key) + 2) } END { print val }' "$file"
}

# env_fill <modèle> <sortie> : recopie le modèle en remplaçant les lignes KEY=… pour chaque
# variable d'environnement FAI_SET_KEY définie. Les valeurs passent par ENVIRON (pas par
# la ligne de commande ni par l'interprétation des « \ » d'awk). Ajoute les clés absentes.
# Le fichier est écrit avec les droits 600.
env_fill() {
  local template="$1" output="$2" tmp
  tmp="$(mktemp "${output}.XXXXXX")"
  (
    umask 077
    awk '
      BEGIN {
        for (name in ENVIRON) if (index(name, "FAI_SET_") == 1) pending[substr(name, 9)] = 1
      }
      match($0, /^[A-Z_][A-Z0-9_]*=/) {
        key = substr($0, 1, RLENGTH - 1)
        if (key in pending) {
          print key "=" ENVIRON["FAI_SET_" key]
          delete pending[key]
          next
        }
      }
      { print }
      END { for (key in pending) print key "=" ENVIRON["FAI_SET_" key] }
    ' "$template" >"$tmp"
  ) || {
    rm -f "$tmp"
    return 1
  }
  chmod 600 "$tmp"
  mv -f "$tmp" "$output"
}

# random_secret → 64 caractères hexadécimaux.
random_secret() {
  if need_cmd openssl; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    printf '\n'
  fi
}

# hash_password <mot de passe> → hash scrypt calculé par l'image (mot de passe passé sur stdin).
hash_password() {
  local hash
  hash="$(printf '%s' "$1" | docker_cmd run --rm -i --network none "$IMAGE" node scripts/hash-password.mjs)" ||
    die "Impossible de calculer le hash du mot de passe (image $IMAGE construite ?)."
  case "$hash" in
    scrypt:*:*) printf '%s' "$hash" ;;
    *) die "Hash de mot de passe inattendu." ;;
  esac
}

# ---------------------------------------------------------------------------
# Sauvegardes (R19 : cohérentes même en mode WAL)
# ---------------------------------------------------------------------------
BACKUP_KEEP=10
BACKUP_FILE=""

# is_backup_name <nom> → 0 si le nom suit exactement finance-AAAAmmjj-HHMMSS.db.
is_backup_name() {
  [[ "$1" =~ ^finance-[0-9]{8}-[0-9]{6}\.db$ ]]
}

# prune_host_backups [dossier] : garde les BACKUP_KEEP sauvegardes les plus récentes (copies
# côté hôte). Ne touche qu'aux fichiers au nom strict finance-AAAAmmjj-HHMMSS.db et à leurs
# compagnons -wal/-shm : jamais finance-1.db ni un autre fichier de l'utilisateur.
prune_host_backups() {
  local dir="${1:-backups}" path name
  local -a names=()
  for path in "$dir"/finance-*.db; do
    [ -f "$path" ] || continue
    name="${path##*/}"
    if is_backup_name "$name"; then
      names+=("$name")
    fi
  done
  [ "${#names[@]}" -gt "$BACKUP_KEEP" ] || return 0
  # Les horodatages se trient comme du texte : les plus récents en premier.
  printf '%s\n' "${names[@]}" | sort -r | tail -n +"$((BACKUP_KEEP + 1))" |
    while IFS= read -r name; do
      path="$dir/$name"
      rm -f "$path" "$path-wal" "$path-shm" 2>/dev/null || as_root rm -f "$path" "$path-wal" "$path-shm"
    done
}

# host_copy_backup <nom> : copie brute data/finance.db (+ -wal, -shm) vers backups/<nom>*,
# en conservant le propriétaire (UID 1001) et en droits 600. Utilisé seulement sans image.
# Renvoie 1 dès qu'une copie échoue (appelée dans un if : errexit n'y joue pas).
host_copy_backup() {
  local name="$1" f dest
  for f in data/finance.db data/finance.db-wal data/finance.db-shm; do
    dest="backups/$name${f#data/finance.db}"
    if [ -r data ] && [ -x data ] && [ -w backups ]; then
      [ -f "$f" ] || continue
      { cp -p "$f" "$dest" && chmod 600 "$dest"; } || return 1
    else
      as_root test -f "$f" || continue
      { as_root cp -p "$f" "$dest" && as_root chmod 600 "$dest"; } || return 1
    fi
  done
}

# backup_db : sauvegarde data/finance.db dans backups/finance-AAAAmmjj-HHMMSS.db.
# Règle BACKUP_FILE (vide si aucune base n'existe encore : ce n'est pas une erreur).
# data/ est en 700 (UID 1001) : l'existence de la base est testée par backup-db.mjs (code 3).
backup_db() {
  local name rc=0
  BACKUP_FILE=""
  name="finance-$(date +%Y%m%d-%H%M%S).db"
  if app_running; then
    # Sauvegarde en ligne via l'API backup de SQLite, dans le conteneur (UID 1001).
    compose exec -T app node scripts/backup-db.mjs "/app/backups/$name" --keep "$BACKUP_KEEP" || rc=$?
  elif docker_cmd image inspect "$IMAGE" >/dev/null 2>&1; then
    # Conteneur arrêté : même script, dans un conteneur éphémère (aucun autre écrivain).
    compose run --rm --no-deps -T app node scripts/backup-db.mjs "/app/backups/$name" --keep "$BACKUP_KEEP" || rc=$?
  elif [ -f data/finance.db ] || as_root test -f data/finance.db; then
    # Pas d'image : copie brute (base + journal WAL) depuis l'hôte.
    [ -d backups ] || mkdir -p backups 2>/dev/null || as_root mkdir -p backups
    if host_copy_backup "$name"; then
      prune_host_backups backups
    else
      rc=1
    fi
  else
    rc=3
  fi
  case "$rc" in
    0) ;;
    3)
      info "Aucune base de données à sauvegarder (première installation ?)."
      return 0
      ;;
    *) die "La sauvegarde a échoué : mise à jour annulée." ;;
  esac
  BACKUP_FILE="backups/$name"
  ok "Sauvegarde créée : $BACKUP_FILE"
}

# restore_command <backups/fichier.db> → commande de restauration (à lancer conteneur arrêté).
# Supprime d'abord les journaux périmés, puis copie la base et, s'il existe, son journal WAL.
restore_command() {
  local b="/app/$1"
  printf '%s run --rm --no-deps app sh -c '"'"'rm -f /app/data/finance.db-wal /app/data/finance.db-shm && cp %s /app/data/finance.db && if [ -f %s-wal ]; then cp %s-wal /app/data/finance.db-wal; fi'"'"'\n' \
    "${COMPOSE[*]}" "$b" "$b" "$b"
}

# secure_data_dirs : data/ et backups/ en 700 (installations antérieures). Linux uniquement ;
# un échec n'est qu'un avertissement.
secure_data_dirs() {
  [ "$(uname -s)" = "Linux" ] || return 0
  local d
  for d in data backups; do
    [ -d "$d" ] || continue
    [ "$(stat -c '%a' "$d")" != "700" ] || continue
    if chmod 700 "$d" 2>/dev/null || (as_root chmod 700 "$d") 2>/dev/null; then
      info "Droits de $d/ resserrés (700)."
    else
      warn "Impossible de passer $d/ en 700 (droits insuffisants) : faites-le avec sudo chmod 700 $d."
    fi
  done
}

# ---------------------------------------------------------------------------
# Version déployée (.deployed-commit, ignoré par git)
# ---------------------------------------------------------------------------

# deployed_commit → commit de la dernière version démarrée avec succès (vide si inconnu).
deployed_commit() {
  [ -f .deployed-commit ] || return 0
  head -n 1 .deployed-commit
}

# mark_deployed : enregistre HEAD comme version déployée (après un démarrage en bonne santé).
mark_deployed() {
  git rev-parse HEAD >.deployed-commit 2>/dev/null || rm -f .deployed-commit
}
