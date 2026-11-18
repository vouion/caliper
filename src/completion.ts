/**
 * Shell completion scripts for caliper (bash / zsh).
 * Emitted by `caliper completion <shell>`; the user sources them, e.g.
 *   caliper completion bash > /etc/bash_completion.d/caliper
 *   caliper completion zsh  > "${fpath[1]}/_caliper"
 * Static scripts (no runtime probing) — they complete commands and common flags.
 */

export const BASH_COMPLETION = `# caliper bash completion
_caliper() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="doctor audit report trend prompt demo experiment help version completion"
  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( \$(compgen -W "\$commands" -- "\$cur") )
    return 0
  fi
  case "\${COMP_WORDS[1]}" in
    experiment)
      COMPREPLY=( \$(compgen -W "list create run report inspect demo" -- "\$cur") ); return 0 ;;
    completion)
      COMPREPLY=( \$(compgen -W "bash zsh" -- "\$cur") ); return 0 ;;
    prompt)
      COMPREPLY=( \$(compgen -W "--agent --min-severity --output --copy --demo --json" -- "\$cur") ); return 0 ;;
    audit)
      COMPREPLY=( \$(compgen -W "--agent --since --all --limit --no-cache --project --json" -- "\$cur") ); return 0 ;;
    report)
      COMPREPLY=( \$(compgen -W "--format --json" -- "\$cur") ); return 0 ;;
  esac
  case "\$prev" in
    --agent) COMPREPLY=( \$(compgen -W "opencode codex claude generic" -- "\$cur") ); return 0 ;;
    --min-severity) COMPREPLY=( \$(compgen -W "low medium high" -- "\$cur") ); return 0 ;;
    --format) COMPREPLY=( \$(compgen -W "json terminal" -- "\$cur") ); return 0 ;;
    --output|--project) COMPREPLY=( \$(compgen -f -- "\$cur") ); return 0 ;;
  esac
  COMPREPLY=( \$(compgen -W "--json --no-color --help" -- "\$cur") )
}
complete -F _caliper caliper
`;

export const ZSH_COMPLETION = `#compdef caliper
# caliper zsh completion
_caliper() {
  local -a commands
  commands=(
    'doctor:check runtime, agent installs, and storage health'
    'audit:analyze sessions and environment'
    'report:re-render the last audit'
    'trend:show finding-count deltas across audits'
    'prompt:generate an agent-ready fix prompt'
    'demo:run the audit on synthetic data'
    'experiment:reproducible configuration experiments'
    'completion:emit shell completion scripts'
    'help:show help'
    'version:print version'
  )
  _arguments -C '1:command:->cmd' '*::arg:->args'
  case \$state in
    cmd) _describe 'command' commands ;;
    args)
      case \$words[1] in
        experiment) _values 'subcommand' list create run report inspect demo ;;
        completion) _values 'shell' bash zsh ;;
        prompt)
          _arguments '--agent[target agent]:agent:(generic opencode codex claude)' \\
            '--min-severity[minimum severity]:severity:(low medium high)' \\
            '--output[write to file]:file:_files' '--copy[copy to clipboard]' \\
            '--demo[use synthetic data]' '--json[JSON output]' ;;
        audit)
          _arguments '--agent[restrict agent]:agent:(opencode codex claude)' \\
            '--since[analysis window]:duration:' '--all[full history]' \\
            '--limit[max sessions]:n:' '--no-cache[bypass cache]' \\
            '--project[project dir]:dir:_files -/' '--json[JSON output]' ;;
      esac
      ;;
  esac
}
_caliper "\$@"
`;
