#!/usr/bin/env bash
# Finance AI — mise à jour : sauvegarde de la base, git pull, reconstruction, redémarrage.
#
#   ./update.sh            met à jour si une nouvelle version est disponible
#   ./update.sh --force    reconstruit et redémarre même sans nouvelle version
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"
# shellcheck source=scripts/lib.sh
. "$script_dir/scripts/lib.sh"

usage() {
  printf 'Usage : ./update.sh [--force]\n'
  printf '  --force  reconstruit et redémarre même si le code n'"'"'a pas changé\n'
}

PREV_COMMIT=""
BRANCH=""

# Affiche la marche à suivre pour revenir en arrière, puis quitte en erreur.
fail_update() {
  printf '\n'
  warn "$1"
  compose logs --tail 50 app 2>/dev/null || true
  printf '\n%s\n' "$(bold "Pour revenir à la version précédente :")"
  printf '  git checkout %s        # code d'"'"'avant la mise à jour\n' "$PREV_COMMIT"
  printf '  %s build\n' "${COMPOSE[*]}"
  if [ -n "$BACKUP_FILE" ]; then
    printf '  %s down\n' "${COMPOSE[*]}"
    printf '  %s run --rm --no-deps app sh -c '"'"'cp /app/%s /app/data/finance.db && rm -f /app/data/finance.db-wal /app/data/finance.db-shm'"'"'\n' \
      "${COMPOSE[*]}" "$BACKUP_FILE"
  fi
  printf '  %s up -d\n' "${COMPOSE[*]}"
  printf '\nRevenez ensuite sur la branche avec : git checkout %s\n' "${BRANCH:-main}"
  if [ -n "$BACKUP_FILE" ]; then
    printf 'Sauvegarde de la base avant mise à jour : %s\n' "$BACKUP_FILE"
  fi
  exit 1
}

main() {
  local force=0 new_commit
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
  PREV_COMMIT="$(git rev-parse HEAD)"

  backup_db

  info "Récupération de la dernière version…"
  git pull --ff-only || die "git pull --ff-only a échoué (historique divergent ?). Aucune modification n'a été appliquée."
  new_commit="$(git rev-parse HEAD)"

  if [ "$new_commit" = "$PREV_COMMIT" ] && [ "$force" != "1" ]; then
    ok "Déjà à jour ($(git rev-parse --short HEAD)). Utilisez --force pour reconstruire quand même."
    return 0
  fi
  if [ "$new_commit" != "$PREV_COMMIT" ]; then
    info "Nouvelle version : $(git rev-parse --short "$PREV_COMMIT") → $(git rev-parse --short HEAD)"
    git --no-pager log --oneline "$PREV_COMMIT..HEAD" | head -n 20 || true
  fi

  info "Reconstruction de l'image…"
  compose build || fail_update "La construction de l'image a échoué (l'ancienne version tourne toujours)."
  info "Redémarrage de l'application…"
  compose up -d || fail_update "docker compose up a échoué."
  wait_healthy 120 || fail_update "L'application ne répond pas après la mise à jour."

  printf '\n'
  ok "$(bold "Mise à jour terminée") ($(git rev-parse --short HEAD))."
}

main "$@"
