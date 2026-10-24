#!/usr/bin/env bash
# Finance AI — mise à jour : sauvegarde de la base, git pull, reconstruction, redémarrage.
#
#   ./update.sh            met à jour si la version déployée n'est pas la dernière
#   ./update.sh --force    reconstruit et redémarre même si tout est à jour
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"
# shellcheck source=scripts/lib.sh
. "$script_dir/scripts/lib.sh"

usage() {
  printf 'Usage : ./update.sh [--force]\n'
  printf '  --force  reconstruit et redémarre même si la version déployée est à jour\n'
}

PREV_COMMIT=""
BRANCH=""

# Échec de la construction : l'image et le conteneur en place n'ont pas changé.
fail_build() {
  printf '\n'
  warn "La construction de l'image a échoué."
  printf '  • La version précédente continue de tourner ; la base de données n'"'"'a pas été modifiée.\n'
  printf '  • Corrigez la cause (espace disque, réseau…) ou attendez un correctif, puis relancez ./update.sh :\n'
  printf '    la reconstruction sera retentée automatiquement.\n'
  exit 1
}

# Échec au démarrage : la nouvelle version a pu migrer la base. Marche à suivre pour revenir en arrière.
fail_start() {
  printf '\n'
  warn "$1"
  compose logs --tail 50 app 2>/dev/null || true
  printf '\n%s\n' "$(bold "Pour revenir à la version précédente :")"
  printf '  git checkout %s        # code de la version précédente\n' "$PREV_COMMIT"
  printf '  %s build\n' "${COMPOSE[*]}"
  if [ -n "$BACKUP_FILE" ]; then
    printf '  %s down\n' "${COMPOSE[*]}"
    printf '  %s' "$(restore_command "$BACKUP_FILE")"
    printf '\n'
  fi
  printf '  %s up -d\n' "${COMPOSE[*]}"
  printf '\nRevenez ensuite sur la branche avec : git checkout %s\n' "${BRANCH:-main}"
  if [ -n "$BACKUP_FILE" ]; then
    printf 'Sauvegarde de la base avant mise à jour : %s\n' "$BACKUP_FILE"
  fi
  exit 1
}

main() {
  local force=0 head deployed
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --force | -f) force=1 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die "Option inconnue : $1"
        ;;
    esac
    shift
  done

  printf '\n%s\n\n' "$(bold "Finance AI — mise à jour")"

  need_cmd git || die "git est requis."
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Lancez update.sh depuis le dépôt Finance AI (clone git)."
  [ -f .env ] || die "Fichier .env absent : lancez d'abord ./install.sh."
  require_docker

  # Les fichiers suivis ne doivent pas être modifiés (.env, data/ et backups/ sont ignorés par git).
  local changes
  changes="$(git status --porcelain --untracked-files=no)"
  if [ -n "$changes" ]; then
    printf '%s\n' "$changes" >&2
    die "Des fichiers du dépôt ont été modifiés localement (liste ci-dessus). Annulez-les (git stash ou git checkout -- <fichier>) puis relancez."
  fi

  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  [ "$BRANCH" != "HEAD" ] || die "Le dépôt n'est sur aucune branche (HEAD détachée) : git checkout main puis relancez."

  # Version réellement en service : celle du dernier démarrage réussi (sinon HEAD actuel).
  deployed="$(deployed_commit)"
  PREV_COMMIT="${deployed:-$(git rev-parse HEAD)}"

  backup_db

  info "Récupération de la dernière version…"
  git pull --ff-only || die "git pull --ff-only a échoué (historique divergent ?). Aucune modification n'a été appliquée."
  head="$(git rev-parse HEAD)"

  if [ "$head" = "$deployed" ] && [ "$force" != "1" ]; then
    ok "Déjà à jour ($(git rev-parse --short HEAD)). Utilisez --force pour reconstruire quand même."
    return 0
  fi
  if [ -z "$deployed" ]; then
    info "Version déployée inconnue : reconstruction de $(git rev-parse --short HEAD)."
  elif [ "$head" != "$deployed" ]; then
    info "Mise à jour : ${deployed:0:7} → $(git rev-parse --short HEAD)"
    git --no-pager log --oneline "$deployed..HEAD" 2>/dev/null | head -n 20 || true
  fi

  info "Reconstruction de l'image…"
  compose build || fail_build
  info "Redémarrage de l'application…"
  compose up -d || fail_start "docker compose up a échoué."
  wait_healthy 120 || fail_start "L'application ne répond pas après la mise à jour."
  mark_deployed

  printf '\n'
  ok "$(bold "Mise à jour terminée") ($(git rev-parse --short HEAD))."
}

main "$@"
