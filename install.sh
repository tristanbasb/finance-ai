#!/usr/bin/env bash
# Finance AI — installation sur un serveur Linux.
#
#   git clone https://github.com/tristanbasb/finance-ai.git && cd finance-ai && ./install.sh
#   ou : curl -fsSL https://raw.githubusercontent.com/tristanbasb/finance-ai/main/install.sh | bash
#
# Variables optionnelles (installation non interactive) :
#   FINANCE_AI_PASSWORD   mot de passe de connexion (8 caractères minimum)
#   ANTHROPIC_API_KEY     clé API Claude (définie mais vide = pas d'IA)
#   CLAUDE_MODEL          modèle Claude (défaut claude-opus-5-5)
#   APP_PORT              port HTTP publié (défaut 3000)
#   FINANCE_AI_YES=1      répond « oui » aux confirmations (ex. installation de Docker)
#   FINANCE_AI_DIR        dossier d'installation en mode curl (défaut ~/finance-ai)
#   FINANCE_AI_REPO       dépôt git à cloner en mode curl (défaut : dépôt officiel, utile pour un fork)
set -euo pipefail

REPO_URL="${FINANCE_AI_REPO:-https://github.com/tristanbasb/finance-ai.git}"
DEFAULT_MODEL="claude-opus-5-5"

# ---------------------------------------------------------------------------
# Amorçage : lancé hors du dépôt (curl … | bash) → clone puis relance install.sh du clone.
# Cette partie ne peut pas utiliser scripts/lib.sh (pas encore téléchargé).
# ---------------------------------------------------------------------------
script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

bootstrap() {
  local dir="${FINANCE_AI_DIR:-$HOME/finance-ai}" answer
  printf '==> Installation de Finance AI dans %s\n' "$dir"
  if [ "$(uname -s)" != "Linux" ] && [ "${FINANCE_AI_ALLOW_NON_LINUX:-0}" != "1" ]; then
    printf ' ✗  Finance AI s'"'"'installe sur un serveur Linux.\n' >&2
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    printf ' !  git est requis.\n' >&2
    if command -v apt-get >/dev/null 2>&1; then
      answer="n"
      if [ "${FINANCE_AI_YES:-0}" = "1" ]; then
        answer="o"
      elif { exec 3</dev/tty; } 2>/dev/null; then
        printf 'Installer git avec apt-get ? [o/N] ' >&2
        read -r answer <&3 || answer="n"
      fi
      case "$answer" in
        [oOyY]*)
          if [ "$(id -u)" -eq 0 ]; then
            apt-get update -qq && apt-get install -y -qq git
          else
            sudo apt-get update -qq && sudo apt-get install -y -qq git
          fi
          ;;
        *)
          printf ' ✗  Installez git puis relancez.\n' >&2
          exit 1
          ;;
      esac
    else
      printf ' ✗  Installez git avec le gestionnaire de paquets de votre distribution puis relancez.\n' >&2
      exit 1
    fi
  fi
  if [ -d "$dir/.git" ]; then
    printf '==> Dépôt déjà présent : %s (utilisé tel quel ; ./update.sh pour le mettre à jour)\n' "$dir"
  elif [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    printf ' ✗  %s existe et n'"'"'est pas vide. Choisissez un autre dossier avec FINANCE_AI_DIR.\n' "$dir" >&2
    exit 1
  else
    git clone "$REPO_URL" "$dir"
  fi
  # stdin est le tube de curl : les questions seront lues sur le terminal.
  if { exec 0</dev/tty; } 2>/dev/null; then :; fi
  exec bash "$dir/install.sh" "$@"
}

if [ -z "$script_dir" ] || [ ! -f "$script_dir/docker-compose.yml" ] || [ ! -f "$script_dir/scripts/lib.sh" ]; then
  bootstrap "$@"
fi

cd "$script_dir"
# shellcheck source=scripts/lib.sh
. "$script_dir/scripts/lib.sh"

# ---------------------------------------------------------------------------
# Étapes
# ---------------------------------------------------------------------------
IS_LINUX=0
ADDED_TO_DOCKER_GROUP=0

check_system() {
  if [ "$(uname -s)" = "Linux" ]; then
    IS_LINUX=1
  elif [ "${FINANCE_AI_ALLOW_NON_LINUX:-0}" = "1" ]; then
    warn "Système $(uname -s) : poursuite autorisée par FINANCE_AI_ALLOW_NON_LINUX=1 (tests uniquement)."
  else
    die "Finance AI s'installe sur un serveur Linux (système détecté : $(uname -s))."
  fi
  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    warn "Ni root ni sudo : l'installation de Docker et les droits sur data/ pourraient échouer."
  fi
  need_cmd git || die "git est requis (ex. : sudo apt-get install -y git)."
  need_cmd curl || die "curl est requis (ex. : sudo apt-get install -y curl)."
}

install_docker() {
  warn "Docker n'est pas installé."
  if [ "$(id -u)" -ne 0 ]; then
    warn "$(id -un) sera ajouté au groupe docker : ce groupe donne des droits équivalents à root."
  fi
  confirm "Installer Docker avec le script officiel https://get.docker.com ?" ||
    die "Docker est requis. Installez-le (https://docs.docker.com/engine/install/) puis relancez."
  info "Installation de Docker…"
  local installer
  installer="$(mktemp)"
  curl -fsSL https://get.docker.com -o "$installer" || die "Téléchargement de get.docker.com impossible."
  as_root sh "$installer" || die "L'installation de Docker a échoué."
  rm -f "$installer"
  if need_cmd systemctl; then
    as_root systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  if [ "$(id -u)" -ne 0 ]; then
    as_root usermod -aG docker "$(id -un)"
    ADDED_TO_DOCKER_GROUP=1
    info "$(id -un) ajouté au groupe docker (effectif à la prochaine connexion ; sudo est utilisé d'ici là)."
  fi
  ok "Docker installé."
}

ensure_docker() {
  need_cmd docker || install_docker
  if ! detect_docker; then
    if need_cmd systemctl; then
      info "Démarrage du service Docker…"
      as_root systemctl start docker >/dev/null 2>&1 || true
    fi
    detect_docker || die "Le démon Docker ne répond pas (docker info). Vérifiez son état : systemctl status docker"
  fi
  detect_compose ||
    die "Docker Compose est introuvable. Installez le plugin (ex. : sudo apt-get install -y docker-compose-plugin) puis relancez."
  ok "Docker $(docker_cmd version --format '{{.Server.Version}}' 2>/dev/null || echo '?') et $(compose version --short 2>/dev/null || echo 'compose') disponibles."
}

build_image() {
  info "Construction de l'image $IMAGE (quelques minutes la première fois)…"
  # docker build plutôt que compose build : compose exige un .env, pas encore créé à ce stade.
  docker_cmd build -t "$IMAGE" . || die "La construction de l'image a échoué."
  ok "Image construite."
}

valid_port() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

create_env() {
  if [ -f .env ]; then
    ok "Fichier .env existant conservé (non modifié)."
    return 0
  fi
  [ -f .env.example ] || die ".env.example introuvable : dépôt incomplet ?"
  info "Configuration (.env)"

  local password hash secret api_key model port
  password="$(read_new_password)"
  info "Calcul du hash du mot de passe…"
  hash="$(hash_password "$password")"
  password=""

  secret="$(random_secret)"
  [ "${#secret}" -ge 32 ] || die "Impossible de générer SESSION_SECRET."

  # Mode non interactif (FINANCE_AI_YES=1 ou sans terminal) : aucune question, valeurs par défaut.
  if [ -n "${ANTHROPIC_API_KEY+x}" ]; then
    api_key="$ANTHROPIC_API_KEY"
  elif non_interactive; then
    api_key=""
  else
    api_key="$(ask_secret "Clé API Claude (optionnelle, Entrée pour ignorer)")"
  fi
  [ -n "$api_key" ] || info "Pas de clé API : les fonctions IA resteront désactivées (ajoutez-la plus tard dans .env)."

  model="${CLAUDE_MODEL:-}"
  [ -n "$model" ] || model="$(ask "Modèle Claude" "$DEFAULT_MODEL")"

  port="${APP_PORT:-}"
  [ -n "$port" ] || port="$(ask "Port HTTP de l'application" "3000")"
  while ! valid_port "$port"; do
    if non_interactive || [ -n "${APP_PORT:-}" ]; then
      die "Port invalide : $port"
    fi
    warn "Port invalide : $port"
    port="$(ask "Port HTTP de l'application" "3000")"
  done

  FAI_SET_APP_PASSWORD_HASH="$hash" \
    FAI_SET_SESSION_SECRET="$secret" \
    FAI_SET_ANTHROPIC_API_KEY="$api_key" \
    FAI_SET_CLAUDE_MODEL="$model" \
    FAI_SET_APP_PORT="$port" \
    FAI_SET_COOKIE_SECURE="auto" \
    FAI_SET_TRUST_PROXY="false" \
    env_fill .env.example .env
  ok "Fichier .env créé (droits 600)."
}

prepare_dirs() {
  mkdir -p data backups 2>/dev/null || as_root mkdir -p data backups
  if [ "$IS_LINUX" != "1" ]; then
    info "Hors Linux : pas de changement de propriétaire pour data/ et backups/."
    return 0
  fi
  local d
  for d in data backups; do
    if [ "$(stat -c '%u:%g' "$d")" != "1001:1001" ]; then
      as_root chown -R 1001:1001 "$d"
    fi
    # Données financières : illisibles pour les autres utilisateurs du serveur.
    if [ "$(stat -c '%a' "$d")" != "700" ]; then
      as_root chmod 700 "$d"
    fi
  done
  ok "Dossiers data/ et backups/ réservés à l'utilisateur du conteneur (UID 1001, droits 700)."
}

start_app() {
  info "Démarrage de l'application…"
  compose up -d || die "docker compose up a échoué."
  if ! wait_healthy 120; then
    compose logs --tail 50 app || true
    die "L'application n'a pas démarré. Journaux ci-dessus ; relancez ./install.sh après correction."
  fi
  mark_deployed
}

print_summary() {
  local port bind host
  port="$(env_get APP_PORT)"
  port="${port:-3000}"
  bind="$(env_get APP_BIND)"
  host=""
  if [ "$bind" != "127.0.0.1" ] && need_cmd hostname; then
    host="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  host="${host:-localhost}"

  printf '\n'
  ok "$(bold "Finance AI est installé !")"
  printf '\n   Adresse : %s\n\n' "$(bold "http://${host}:${port}")"
  printf '   Prochaines étapes :\n'
  printf '   • HTTPS : placez un reverse proxy devant l'"'"'application (exemple Caddy dans le README).\n'
  printf '   • Mise à jour : cd %s && ./update.sh\n' "$script_dir"
  printf '   • Mot de passe : ./scripts/set-password.sh\n'
  printf '   • Journaux : docker compose logs -f app\n'
  if [ "$ADDED_TO_DOCKER_GROUP" = "1" ]; then
    printf '   • Reconnectez-vous pour utiliser docker sans sudo.\n'
  fi
  printf '\n'
}

main() {
  printf '\n%s\n\n' "$(bold "Finance AI — installation")"
  check_system
  # Échouer tout de suite plutôt qu'après l'installation de Docker et le build.
  if [ ! -f .env ] && non_interactive && [ -z "${FINANCE_AI_PASSWORD:-}" ]; then
    die "Mode non interactif (FINANCE_AI_YES=1 ou pas de terminal) : définissez FINANCE_AI_PASSWORD."
  fi
  ensure_docker
  build_image
  create_env
  prepare_dirs
  start_app
  print_summary
}

main "$@"
