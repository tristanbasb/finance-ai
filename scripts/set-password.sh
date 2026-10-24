#!/usr/bin/env bash
# Finance AI — change le mot de passe de connexion.
# Remplace APP_PASSWORD_HASH dans .env, régénère SESSION_SECRET (toutes les sessions
# ouvertes sont déconnectées) puis redémarre l'application.
# Non interactif : FINANCE_AI_PASSWORD=… ./scripts/set-password.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(dirname "$script_dir")"
cd "$repo_dir"
# shellcheck source=scripts/lib.sh
. "$script_dir/lib.sh"

main() {
  [ -f .env ] || die "Fichier .env absent : lancez d'abord ./install.sh."
  require_docker
  docker_cmd image inspect "$IMAGE" >/dev/null 2>&1 || die "Image $IMAGE introuvable : lancez d'abord ./install.sh."

  local password hash secret
  password="$(read_new_password)"
  info "Calcul du hash du mot de passe…"
  hash="$(hash_password "$password")"
  password=""
  secret="$(random_secret)"

  FAI_SET_APP_PASSWORD_HASH="$hash" FAI_SET_SESSION_SECRET="$secret" env_fill .env .env
  ok "Mot de passe mis à jour dans .env (sessions existantes révoquées)."

  info "Redémarrage de l'application pour appliquer la configuration…"
  compose up -d --force-recreate app || die "docker compose up a échoué."
  wait_healthy 120 || die "L'application ne répond pas après le redémarrage : docker compose logs app"
  ok "Nouveau mot de passe actif."
}

main "$@"
