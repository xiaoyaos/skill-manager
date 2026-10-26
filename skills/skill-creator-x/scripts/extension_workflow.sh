#!/usr/bin/env bash

# 允许用户误用 `sh` 启动时自动切回 bash。
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    exec bash "$0" "$@"
  fi
  echo "[ERROR] extension_workflow.sh 需要 bash 运行环境。" >&2
  exit 1
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="$ROOT_DIR/.workflow-cache"
STATE_FILE="$STATE_DIR/extension-workflow.state"
TEMPLATE_FILE="$ROOT_DIR/extensions/pending/_TEMPLATE.md"
SKILL_FILE="$ROOT_DIR/SKILL.md"
REGISTRY_FILE="$ROOT_DIR/extensions/registry.md"

STATUS="IN_PROGRESS"
CURRENT_STEP="1"
CURRENT_PHASE=""
WORK_ID=""
EXT_DATE=""
EXT_ID=""
EXT_TITLE=""
EXT_SLUG=""
SOURCE="chat"
SOURCE_CONFIRMED="no"
EXT_FILE=""
EXT_FILE_REL=""
PRE_EXT_COUNT="0"
PRE_REG_COUNT="0"
SNAPSHOT_FILE=""
NEED_VALIDATION=""
WORKFLOW_ACTIVE="no"
EXT_LIST_IDS=()
EXT_LIST_TITLES=()

show_help() {
  cat <<'EOF'
交互式扩展迭代向导

用途：
  提供扩展能力管理与迭代工作流：
  - 扩展列表查询
  - 删除指定扩展
  - 按 README 的 SOP 分步骤完成扩展需求编写、集成、校验与可选验证

特性：
  - 每一步自动缓存状态，异常退出后可从断点恢复
  - 检测到未完成工作时，强制二选一：
    1) 不保留并进入新工作
    2) 继续未完成工作
  - 编辑文件时支持二选一：
    1) 进入 IDE 编辑
    2) 当前 shell 进程中用 vim/vi 编辑（可用时）
  - 目标文件不存在时，若有模板会先初始化模板再编辑

用法：
  bash scripts/extension_workflow.sh
  bash scripts/extension_workflow.sh --help
EOF
}

reset_state() {
  STATUS="IN_PROGRESS"
  CURRENT_STEP="1"
  CURRENT_PHASE=""
  WORK_ID=""
  EXT_DATE=""
  EXT_ID=""
  EXT_TITLE=""
  EXT_SLUG=""
  SOURCE="chat"
  SOURCE_CONFIRMED="no"
  EXT_FILE=""
  EXT_FILE_REL=""
  PRE_EXT_COUNT="0"
  PRE_REG_COUNT="0"
  SNAPSHOT_FILE=""
  NEED_VALIDATION=""
}

save_state() {
  mkdir -p "$STATE_DIR"
  cat >"$STATE_FILE" <<EOF
STATUS=$(printf '%q' "$STATUS")
CURRENT_STEP=$(printf '%q' "$CURRENT_STEP")
CURRENT_PHASE=$(printf '%q' "$CURRENT_PHASE")
WORK_ID=$(printf '%q' "$WORK_ID")
EXT_DATE=$(printf '%q' "$EXT_DATE")
EXT_ID=$(printf '%q' "$EXT_ID")
EXT_TITLE=$(printf '%q' "$EXT_TITLE")
EXT_SLUG=$(printf '%q' "$EXT_SLUG")
SOURCE=$(printf '%q' "$SOURCE")
SOURCE_CONFIRMED=$(printf '%q' "$SOURCE_CONFIRMED")
EXT_FILE=$(printf '%q' "$EXT_FILE")
EXT_FILE_REL=$(printf '%q' "$EXT_FILE_REL")
PRE_EXT_COUNT=$(printf '%q' "$PRE_EXT_COUNT")
PRE_REG_COUNT=$(printf '%q' "$PRE_REG_COUNT")
SNAPSHOT_FILE=$(printf '%q' "$SNAPSHOT_FILE")
NEED_VALIDATION=$(printf '%q' "$NEED_VALIDATION")
EOF
}

load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
  fi
}

cleanup_state() {
  rm -f "$STATE_FILE"
}

on_exit() {
  if [[ "${WORKFLOW_ACTIVE:-no}" == "yes" && "${STATUS:-IN_PROGRESS}" != "COMPLETED" ]]; then
    save_state
  fi
}

on_interrupt() {
  echo
  echo "[INFO] 已中断。当前进度已缓存，可下次继续。"
  exit 130
}

normalize_ext_id() {
  local raw="$1"
  local cleaned
  cleaned="$(echo "$raw" | tr '[:upper:]' '[:lower:]')"
  cleaned="${cleaned#ext-}"
  cleaned="$(echo "$cleaned" | tr -cd '0-9')"
  if [[ -z "$cleaned" ]]; then
    echo ""
    return 0
  fi
  printf "%04d" "$((10#$cleaned))"
}

normalize_slug() {
  local raw="$1"
  local slug
  slug="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
  if [[ -z "$slug" ]]; then
    slug="update"
  fi
  echo "$slug"
}

clear_for_choice() {
  if [[ -t 1 ]]; then
    if command -v clear >/dev/null 2>&1; then
      clear
    else
      printf '\033[2J\033[H'
    fi
  fi
}

pause_for_continue() {
  if [[ -t 0 && -t 1 ]]; then
    echo
    read -r -p "按回车继续..." _
  fi
}

build_ext_paths() {
  if [[ -z "$EXT_DATE" ]]; then
    EXT_DATE="$(date '+%Y-%m-%d')"
  fi

  if [[ -n "$EXT_ID" && -n "$EXT_SLUG" ]]; then
    EXT_FILE="$ROOT_DIR/extensions/pending/${EXT_DATE}-ext-${EXT_ID}-${EXT_SLUG}.md"
    EXT_FILE_REL="extensions/pending/${EXT_DATE}-ext-${EXT_ID}-${EXT_SLUG}.md"
  else
    EXT_FILE=""
    EXT_FILE_REL=""
  fi
}

prefill_requirement_placeholders() {
  local target="$1"
  if [[ ! -f "$target" ]]; then
    return 0
  fi
  if [[ -z "$EXT_ID" ]]; then
    return 0
  fi

  local doc_title="$EXT_TITLE"
  if [[ -z "$doc_title" ]]; then
    doc_title="$EXT_SLUG"
  fi
  if [[ -z "$doc_title" ]]; then
    doc_title="update"
  fi

  local tmp_file
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/extension-workflow.XXXXXX")"
  awk -v ext_id="$EXT_ID" -v doc_title="$doc_title" '
    BEGIN { replaced=0 }
    {
      if (!replaced && $0 ~ /^# 扩展需求：EXT-XXXX（标题）$/) {
        print "# 扩展需求：EXT-" ext_id "（" doc_title "）"
        replaced=1
        next
      }
      print
    }
  ' "$target" >"$tmp_file"
  mv "$tmp_file" "$target"

  if ! grep -q '^来源:' "$target"; then
    tmp_file="$(mktemp "${TMPDIR:-/tmp}/extension-workflow.XXXXXX")"
    awk -v source="$SOURCE" '
      BEGIN { inserted=0 }
      {
        print
        if (!inserted && $0 ~ /^## 背景$/) {
          print ""
          print "来源: " source
          inserted=1
        }
      }
    ' "$target" >"$tmp_file"
    mv "$tmp_file" "$target"
  fi
}

count_ext_blocks() {
  if [[ -f "$SKILL_FILE" ]]; then
    grep -c '^### EXT-' "$SKILL_FILE" || true
  else
    echo "0"
  fi
}

count_registry_entries() {
  if [[ -f "$REGISTRY_FILE" ]]; then
    grep -c '^- 时间:' "$REGISTRY_FILE" || true
  else
    echo "0"
  fi
}

collect_extension_catalog_lines() {
  local raw_tmp merged_tmp
  raw_tmp="$(mktemp "${TMPDIR:-/tmp}/extension-catalog-raw.XXXXXX")"
  merged_tmp="$(mktemp "${TMPDIR:-/tmp}/extension-catalog-merged.XXXXXX")"

  if [[ -f "$SKILL_FILE" ]]; then
    sed -nE 's/^# 扩展需求：EXT-([0-9]{4})（(.*)）$/\1|\2/p' "$SKILL_FILE" >>"$raw_tmp"
    sed -nE 's/^# 扩展需求：EXT-([0-9]{4})$/\1|/p' "$SKILL_FILE" >>"$raw_tmp"
  fi

  if [[ -d "$ROOT_DIR/extensions/pending" ]]; then
    find "$ROOT_DIR/extensions/pending" -maxdepth 1 -type f -name '*ext-*.md' -print 2>/dev/null | sort | while IFS= read -r file; do
      local base id title slug
      base="$(basename "$file")"
      id="$(echo "$base" | sed -nE 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-ext-([0-9]{4})-.*\.md$/\1/p')"
      [[ -n "$id" ]] || continue
      title="$(sed -nE 's/^# 扩展需求：EXT-[0-9]{4}（(.*)）$/\1/p' "$file" | head -n1)"
      if [[ -z "$title" ]]; then
        slug="$(echo "$base" | sed -nE 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-ext-[0-9]{4}-(.*)\.md$/\1/p')"
        title="$slug"
      fi
      echo "${id}|${title}" >>"$raw_tmp"
    done
  fi

  if [[ -d "$ROOT_DIR/extensions/applied" ]]; then
    find "$ROOT_DIR/extensions/applied" -maxdepth 1 -type f -name '*ext-*.md' -print 2>/dev/null | sort | while IFS= read -r file; do
      local base id title slug
      base="$(basename "$file")"
      id="$(echo "$base" | sed -nE 's/^[0-9]{8}-[0-9]{6}-[0-9]{4}-[0-9]{2}-[0-9]{2}-ext-([0-9]{4})-.*\.md$/\1/p')"
      [[ -n "$id" ]] || continue
      title="$(sed -nE 's/^# 扩展需求：EXT-[0-9]{4}（(.*)）$/\1/p' "$file" | head -n1)"
      if [[ -z "$title" ]]; then
        slug="$(echo "$base" | sed -nE 's/^[0-9]{8}-[0-9]{6}-[0-9]{4}-[0-9]{2}-[0-9]{2}-ext-[0-9]{4}-(.*)\.md$/\1/p')"
        title="$slug"
      fi
      echo "${id}|${title}" >>"$raw_tmp"
    done
  fi

  awk -F'|' '
    function trim(s) {
      gsub(/^[ \t]+|[ \t]+$/, "", s)
      return s
    }
    {
      id = trim($1)
      title = trim($2)
      if (id == "") next
      if (!(id in seen)) {
        seen[id] = 1
        titles[id] = title
        order[++n] = id
      } else if (titles[id] == "" && title != "") {
        titles[id] = title
      }
    }
    END {
      for (i = 1; i <= n; i++) {
        id = order[i]
        print id "|" titles[id]
      }
    }
  ' "$raw_tmp" | sort -t'|' -k1,1n >"$merged_tmp"

  cat "$merged_tmp"
  rm -f "$raw_tmp" "$merged_tmp"
}

load_extension_catalog() {
  EXT_LIST_IDS=()
  EXT_LIST_TITLES=()

  local catalog_tmp
  catalog_tmp="$(mktemp "${TMPDIR:-/tmp}/extension-catalog-read.XXXXXX")"
  collect_extension_catalog_lines >"$catalog_tmp"

  while IFS='|' read -r ext_id ext_title; do
    [[ -n "$ext_id" ]] || continue
    if [[ -z "$ext_title" ]]; then
      ext_title="(无标题)"
    fi
    EXT_LIST_IDS+=("$ext_id")
    EXT_LIST_TITLES+=("$ext_title")
  done <"$catalog_tmp"

  rm -f "$catalog_tmp"
}

extension_index_by_id() {
  local target_id="$1"
  local i
  for i in "${!EXT_LIST_IDS[@]}"; do
    if [[ "${EXT_LIST_IDS[$i]}" == "$target_id" ]]; then
      echo "$i"
      return 0
    fi
  done
  echo "-1"
}

resolve_extension_selector() {
  local selector="$1"
  local total="${#EXT_LIST_IDS[@]}"

  if [[ "$total" -eq 0 ]]; then
    echo ""
    return 0
  fi

  if [[ "$selector" =~ ^[eE][xX][tT]-?[0-9]+$ ]]; then
    local by_id
    by_id="$(normalize_ext_id "$selector")"
    if [[ "$(extension_index_by_id "$by_id")" -ge 0 ]]; then
      echo "$by_id"
      return 0
    fi
    echo ""
    return 0
  fi

  if [[ "$selector" =~ ^0[0-9]+$ ]]; then
    local by_id
    by_id="$(normalize_ext_id "$selector")"
    if [[ "$(extension_index_by_id "$by_id")" -ge 0 ]]; then
      echo "$by_id"
      return 0
    fi
    echo ""
    return 0
  fi

  if [[ "$selector" =~ ^[1-9][0-9]*$ ]]; then
    if (( selector >= 1 && selector <= total )); then
      echo "${EXT_LIST_IDS[$((selector - 1))]}"
      return 0
    fi
    local by_id
    by_id="$(normalize_ext_id "$selector")"
    if [[ "$(extension_index_by_id "$by_id")" -ge 0 ]]; then
      echo "$by_id"
      return 0
    fi
  fi

  echo ""
}

print_extension_catalog() {
  local i
  if [[ "${#EXT_LIST_IDS[@]}" -eq 0 ]]; then
    echo "  (未发现扩展记录)"
    return 0
  fi
  for i in "${!EXT_LIST_IDS[@]}"; do
    printf "  [%2d] %-9s  %s\n" "$((i + 1))" "EXT-${EXT_LIST_IDS[$i]}" "${EXT_LIST_TITLES[$i]}"
  done
}

list_extensions() {
  echo
  echo "== 扩展列表查询 =="
  load_extension_catalog
  echo
  print_extension_catalog
  if [[ "${#EXT_LIST_IDS[@]}" -gt 0 ]]; then
    echo
    echo "  共 ${#EXT_LIST_IDS[@]} 项"
  fi
  pause_for_continue
}

remove_skill_blocks_for_ext_id() {
  local ext_id="$1"
  local tmp_file
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/skill-remove.XXXXXX")"

  awk -v ext_id="$ext_id" '
    function flush_block() {
      if (in_block == 0) {
        return
      }
      target = "# 扩展需求：EXT-" ext_id
      if (index(block, target) == 0) {
        printf "%s", block
      }
      block = ""
      in_block = 0
    }

    {
      if ($0 ~ /^### EXT-/) {
        flush_block()
        in_block = 1
        block = $0 ORS
        next
      }

      if (in_block == 1) {
        block = block $0 ORS
        next
      }

      print
    }

    END {
      flush_block()
    }
  ' "$SKILL_FILE" >"$tmp_file"

  mv "$tmp_file" "$SKILL_FILE"
}

delete_extension_interactive() {
  clear_for_choice

  load_extension_catalog
  if [[ "${#EXT_LIST_IDS[@]}" -eq 0 ]]; then
    echo "[INFO] 当前没有可删除的扩展。"
    pause_for_continue
    return 0
  fi

  local selector ext_id selected_index selected_title
  clear_for_choice
  echo
  echo "== 删除指定扩展 =="
  echo
  print_extension_catalog
  echo
  read -r -p "输入序号或编号（示例：1 / 0002 / ext-0002）: " selector
  ext_id="$(resolve_extension_selector "$selector")"
  if [[ -z "$ext_id" ]]; then
    echo "[WARN] 未匹配到有效扩展，请输入列表中的序号或编号。"
    pause_for_continue
    return 0
  fi

  selected_index="$(extension_index_by_id "$ext_id")"
  if [[ "$selected_index" -ge 0 ]]; then
    selected_title="${EXT_LIST_TITLES[$selected_index]}"
  else
    selected_title="(无标题)"
  fi

  local pending_matches applied_matches registry_matches skill_matches
  pending_matches="$(find "$ROOT_DIR/extensions/pending" -maxdepth 1 -type f -name "*ext-${ext_id}-*.md" -print 2>/dev/null | sort || true)"
  applied_matches="$(find "$ROOT_DIR/extensions/applied" -maxdepth 1 -type f -name "*ext-${ext_id}-*.md" -print 2>/dev/null | sort || true)"
  registry_matches="$(grep -n "ext-${ext_id}-" "$REGISTRY_FILE" 2>/dev/null || true)"
  skill_matches="$(grep -n "^# 扩展需求：EXT-${ext_id}" "$SKILL_FILE" 2>/dev/null || true)"

  if [[ -z "$pending_matches" && -z "$applied_matches" && -z "$registry_matches" && -z "$skill_matches" ]]; then
    echo "[INFO] 未找到 EXT-${ext_id} 相关记录。"
    pause_for_continue
    return 0
  fi

  local pending_count applied_count registry_count skill_count
  pending_count="$(printf '%s\n' "$pending_matches" | sed '/^$/d' | wc -l | tr -d ' ')"
  applied_count="$(printf '%s\n' "$applied_matches" | sed '/^$/d' | wc -l | tr -d ' ')"
  registry_count="$(printf '%s\n' "$registry_matches" | sed '/^$/d' | wc -l | tr -d ' ')"
  skill_count="$(printf '%s\n' "$skill_matches" | sed '/^$/d' | wc -l | tr -d ' ')"

  while true; do
    clear_for_choice
    echo
    echo "== 删除指定扩展 =="
    echo
    echo "将处理 EXT-${ext_id}（${selected_title}）"
    echo "影响范围："
    printf "  %-10s %s\n" "pending" "${pending_count} 文件"
    printf "  %-10s %s\n" "applied" "${applied_count} 文件"
    printf "  %-10s %s\n" "registry" "${registry_count} 行"
    printf "  %-10s %s\n" "SKILL" "${skill_count} 处"

    if [[ -n "$pending_matches" || -n "$applied_matches" ]]; then
      echo
      echo "文件明细："
      if [[ -n "$pending_matches" ]]; then
        while IFS= read -r file; do
          [[ -n "$file" ]] || continue
          echo "  - pending: $(basename "$file")"
        done <<<"$pending_matches"
      fi
      if [[ -n "$applied_matches" ]]; then
        while IFS= read -r file; do
          [[ -n "$file" ]] || continue
          echo "  - applied: $(basename "$file")"
        done <<<"$applied_matches"
      fi
    fi

    echo
    echo "确认删除？"
    echo "1. 确认删除"
    echo "2. 取消"
    local confirm_delete
    read -r -p "请输入 1 或 2: " confirm_delete
    case "$confirm_delete" in
      1)
        break
        ;;
      2)
        echo "[INFO] 已取消删除。"
        pause_for_continue
        return 0
        ;;
      *)
        echo "[WARN] 仅支持 1 或 2。"
        ;;
    esac
  done

  local pending_deleted applied_deleted
  pending_deleted=0
  applied_deleted=0

  if [[ -n "$pending_matches" ]]; then
    while IFS= read -r file; do
      [[ -n "$file" ]] || continue
      rm -f "$file"
      pending_deleted=$((pending_deleted + 1))
    done <<<"$pending_matches"
  fi

  if [[ -n "$applied_matches" ]]; then
    while IFS= read -r file; do
      [[ -n "$file" ]] || continue
      rm -f "$file"
      applied_deleted=$((applied_deleted + 1))
    done <<<"$applied_matches"
  fi

  local registry_removed
  registry_removed="no"
  if [[ -f "$REGISTRY_FILE" ]] && grep -q "ext-${ext_id}-" "$REGISTRY_FILE"; then
    local reg_tmp
    reg_tmp="$(mktemp "${TMPDIR:-/tmp}/registry-remove.XXXXXX")"
    awk -v ext_id="$ext_id" 'index($0, "ext-" ext_id "-") == 0 { print }' "$REGISTRY_FILE" >"$reg_tmp"
    mv "$reg_tmp" "$REGISTRY_FILE"
    registry_removed="yes"
  fi

  local skill_before skill_after skill_removed
  skill_before="$(grep -c "^# 扩展需求：EXT-${ext_id}" "$SKILL_FILE" 2>/dev/null || true)"
  if [[ "$skill_before" -gt 0 ]]; then
    remove_skill_blocks_for_ext_id "$ext_id"
  fi
  skill_after="$(grep -c "^# 扩展需求：EXT-${ext_id}" "$SKILL_FILE" 2>/dev/null || true)"
  skill_removed=$((skill_before - skill_after))

  echo
  echo "[OK] 删除完成：EXT-${ext_id}"
  echo "- pending 删除: ${pending_deleted}"
  echo "- applied 删除: ${applied_deleted}"
  echo "- registry 已更新: ${registry_removed}"
  echo "- SKILL 移除块数: ${skill_removed}"
  pause_for_continue
}

choose_entry_action() {
  while true; do
    clear_for_choice
    echo
    echo "== 主菜单 =="
    echo "1. 新增扩展"
    echo "2. 扩展列表查询"
    echo "3. 删除指定扩展"
    echo "4. 退出"
    local entry_choice
    read -r -p "请输入 1/2/3/4: " entry_choice
    case "$entry_choice" in
      1)
        return 0
        ;;
      2)
        list_extensions
        ;;
      3)
        delete_extension_interactive
        ;;
      4)
        echo "[OK] 已退出。"
        exit 0
        ;;
      *)
        echo "[WARN] 仅支持 1/2/3/4。"
        ;;
    esac
  done
}

open_in_ide() {
  local file="$1"
  if command -v code >/dev/null 2>&1; then
    echo "[INFO] 使用 VS Code 打开：$file"
    code -w "$file"
    return 0
  fi
  if command -v cursor >/dev/null 2>&1; then
    echo "[INFO] 使用 Cursor 打开：$file"
    cursor -w "$file"
    return 0
  fi
  if command -v open >/dev/null 2>&1; then
    echo "[INFO] 使用系统默认应用打开：$file"
    open "$file"
    echo "编辑完成并保存后，按回车继续..."
    read -r _
    return 0
  fi
  echo "[WARN] 未检测到可用 IDE 命令（code/cursor/open）。"
  return 1
}

open_in_vim() {
  local file="$1"
  if command -v vim >/dev/null 2>&1; then
    vim "$file"
    return 0
  fi
  if command -v vi >/dev/null 2>&1; then
    vi "$file"
    return 0
  fi
  echo "[WARN] 当前环境未检测到 vim/vi。"
  return 1
}

edit_file_interactively() {
  local target="$1"
  local template="$2"

  if [[ ! -f "$target" ]]; then
    mkdir -p "$(dirname "$target")"
    if [[ -f "$template" ]]; then
      cp "$template" "$target"
      echo "[OK] 已按模板初始化：$target"
    else
      : >"$target"
      echo "[WARN] 模板不存在，已创建空文件：$target"
    fi
    prefill_requirement_placeholders "$target"
  else
    prefill_requirement_placeholders "$target"
  fi

  while true; do
    clear_for_choice
    echo
    echo "请选择编辑方式："
    echo "1. 进入 IDE 编辑"
    echo "2. 当前 shell 使用 vim/vi 编辑"
    CURRENT_PHASE="step2.choose_editor"
    save_state
    read -r -p "请输入 1 或 2: " editor_choice
    case "$editor_choice" in
      1)
        if open_in_ide "$target"; then
          return 0
        fi
        ;;
      2)
        if open_in_vim "$target"; then
          return 0
        fi
        ;;
      *)
        echo "[WARN] 仅支持 1 或 2。"
        ;;
    esac
  done
}

enforce_resume_choice_if_needed() {
  if [[ ! -f "$STATE_FILE" ]]; then
    reset_state
    WORK_ID="$(date '+%Y%m%d-%H%M%S')"
    save_state
    return 0
  fi

  load_state
  build_ext_paths
  if [[ "${STATUS:-IN_PROGRESS}" == "COMPLETED" ]]; then
    cleanup_state
    reset_state
    WORK_ID="$(date '+%Y%m%d-%H%M%S')"
    save_state
    return 0
  fi

  while true; do
    clear_for_choice
    echo "检测到未完成工作："
    echo "- 工作ID: ${WORK_ID:-unknown}"
    echo "- 当前步骤: ${CURRENT_STEP:-1}"
    if [[ -n "${CURRENT_PHASE:-}" ]]; then
      echo "- 当前阶段: ${CURRENT_PHASE}"
    fi
    if [[ -n "${EXT_ID:-}" ]]; then
      echo "- 扩展编号: EXT-${EXT_ID}"
    fi
    if [[ -n "${EXT_TITLE:-}" ]]; then
      echo "- 扩展标题: ${EXT_TITLE}"
    fi
    if [[ -n "${EXT_FILE:-}" ]]; then
      echo "- 需求文件: $EXT_FILE"
    fi
    echo
    echo "必须选择以下之一："
    echo "1. 不保留并进入新工作"
    echo "2. 继续未完成工作"

    read -r -p "请输入 1 或 2: " resume_choice
    case "$resume_choice" in
      1)
        cleanup_state
        reset_state
        WORK_ID="$(date '+%Y%m%d-%H%M%S')"
        save_state
        echo "[OK] 已开始新工作。"
        return 0
        ;;
      2)
        echo "[OK] 将从步骤 ${CURRENT_STEP} 继续。"
        return 0
        ;;
      *)
        echo "[WARN] 仅支持 1 或 2。"
        ;;
    esac
  done
}

step1_collect_metadata() {
  CURRENT_STEP="1"
  CURRENT_PHASE="step1.enter"
  save_state

  echo
  echo "== 步骤 1/6：创建本次扩展任务信息 =="

  if [[ -z "$EXT_DATE" ]]; then
    EXT_DATE="$(date '+%Y-%m-%d')"
    save_state
  fi

  if [[ -z "$EXT_ID" ]]; then
    local raw_id=""
    local norm_id=""
    while true; do
      CURRENT_PHASE="step1.input_id"
      save_state
      read -r -p "输入扩展编号（示例：0002 或 ext-0002）: " raw_id
      norm_id="$(normalize_ext_id "$raw_id")"
      if [[ -n "$norm_id" ]]; then
        EXT_ID="$norm_id"
        save_state
        break
      fi
      echo "[WARN] 编号无效，请输入数字编号。"
    done
  else
    echo "[INFO] 已恢复扩展编号：EXT-$EXT_ID"
  fi

  if [[ -z "$EXT_TITLE" ]]; then
    local raw_title=""
    while true; do
      CURRENT_PHASE="step1.input_title"
      save_state
      read -r -p "输入扩展标题（用于文档标题）: " raw_title
      raw_title="$(echo "$raw_title" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      if [[ -n "$raw_title" ]]; then
        EXT_TITLE="$raw_title"
        save_state
        break
      fi
      echo "[WARN] 标题不能为空。"
    done
  else
    echo "[INFO] 已恢复扩展标题：$EXT_TITLE"
  fi

  if [[ -z "$EXT_SLUG" ]]; then
    local raw_slug=""
    local norm_slug=""
    local default_slug
    default_slug="$(normalize_slug "$EXT_TITLE")"
    while true; do
      CURRENT_PHASE="step1.input_slug"
      save_state
      read -r -p "输入文件短标题 slug（默认: ${default_slug}）: " raw_slug
      if [[ -z "$raw_slug" ]]; then
        raw_slug="$default_slug"
      fi
      norm_slug="$(normalize_slug "$raw_slug")"
      if [[ -n "$norm_slug" ]]; then
        EXT_SLUG="$norm_slug"
        save_state
        break
      fi
      echo "[WARN] slug 无效，请重新输入。"
    done
  else
    echo "[INFO] 已恢复文件短标题 slug：$EXT_SLUG"
  fi

  if [[ "$SOURCE_CONFIRMED" != "yes" ]]; then
    local chosen_source=""
    CURRENT_PHASE="step1.input_source"
    save_state
    read -r -p "输入来源 source（默认 ${SOURCE:-chat}）: " chosen_source
    if [[ -n "$chosen_source" ]]; then
      SOURCE="$chosen_source"
    elif [[ -z "$SOURCE" ]]; then
      SOURCE="chat"
    fi
    SOURCE_CONFIRMED="yes"
    save_state
  else
    echo "[INFO] 已恢复来源 source：$SOURCE"
  fi

  build_ext_paths

  echo
  echo "本次任务信息："
  echo "- 日期: $EXT_DATE"
  echo "- 编号: EXT-$EXT_ID"
  echo "- 标题: $EXT_TITLE"
  echo "- 文件短标题: $EXT_SLUG"
  echo "- source: $SOURCE"
  echo "- 需求文件: $EXT_FILE_REL"

  CURRENT_PHASE="step1.summary"
  save_state
  return 0
}

step2_edit_requirement_file() {
  CURRENT_STEP="2"
  CURRENT_PHASE="step2.enter"
  save_state

  build_ext_paths
  if [[ -z "$EXT_FILE" ]]; then
    echo "[WARN] 当前未生成需求文件路径，先回到步骤 1 补全元信息。"
    CURRENT_STEP="1"
    CURRENT_PHASE="step1.enter"
    save_state
    return 1
  fi

  echo
  echo "== 步骤 2/6：编辑扩展需求文档 =="
  CURRENT_PHASE="step2.editing"
  save_state
  edit_file_interactively "$EXT_FILE" "$TEMPLATE_FILE"

  if grep -Eq 'EXT-XXXX|要求 1|可观察结果 1|填写验证命令' "$EXT_FILE"; then
    echo
    echo "[WARN] 检测到模板占位内容仍存在。"
    while true; do
      clear_for_choice
      echo
      echo "== 步骤 2/6：编辑扩展需求文档 =="
      echo "[WARN] 检测到模板占位内容仍存在。"
      echo "1. 继续编辑"
      echo "2. 按当前内容继续下一步"
      CURRENT_PHASE="step2.placeholder_check"
      save_state
      read -r -p "请输入 1 或 2: " placeholder_choice
      case "$placeholder_choice" in
        1)
          CURRENT_PHASE="step2.re_editing"
          save_state
          edit_file_interactively "$EXT_FILE" "$TEMPLATE_FILE"
          if ! grep -Eq 'EXT-XXXX|要求 1|可观察结果 1|填写验证命令' "$EXT_FILE"; then
            break
          fi
          ;;
        2)
          break
          ;;
        *)
          echo "[WARN] 仅支持 1 或 2。"
          ;;
      esac
    done
  fi

  CURRENT_PHASE="step2.done"
  save_state
  return 0
}

step3_integrate_extension() {
  CURRENT_STEP="3"
  CURRENT_PHASE="step3.enter"
  save_state

  build_ext_paths
  if [[ -z "$EXT_FILE_REL" ]]; then
    echo "[WARN] 当前未生成需求文件路径，先回到步骤 1。"
    CURRENT_STEP="1"
    CURRENT_PHASE="step1.enter"
    save_state
    return 1
  fi

  echo
  echo "== 步骤 3/6：执行扩展集成 =="
  PRE_EXT_COUNT="$(count_ext_blocks)"
  PRE_REG_COUNT="$(count_registry_entries)"
  CURRENT_PHASE="step3.integrating"
  save_state

  local output=""
  if output="$(cd "$ROOT_DIR" && bash scripts/integrate_extension.sh "$EXT_FILE_REL" "$SOURCE" 2>&1)"; then
    echo "$output"
    SNAPSHOT_FILE="$(echo "$output" | sed -n 's/^- snapshot: //p' | tail -n1)"
    if [[ -z "$SNAPSHOT_FILE" ]]; then
      local base_name
      base_name="$(basename "$EXT_FILE")"
      SNAPSHOT_FILE="$(ls -1t "$ROOT_DIR"/extensions/applied/*-"$base_name" 2>/dev/null | head -n1 || true)"
    fi
    save_state
    return 0
  fi

  echo "$output"
  echo "[ERROR] 扩展集成失败。"
  echo "你可以先回到上一步继续编辑需求文档。"
  while true; do
    clear_for_choice
    echo
    echo "== 步骤 3/6：执行扩展集成 =="
    echo "[ERROR] 扩展集成失败。"
    echo "你可以先回到上一步继续编辑需求文档。"
    echo "1. 回到编辑需求文档"
    echo "2. 重试当前集成步骤"
    CURRENT_PHASE="step3.failed_retry_choice"
    save_state
    read -r -p "请输入 1 或 2: " retry_choice
    case "$retry_choice" in
      1)
        CURRENT_STEP="2"
        save_state
        return 1
        ;;
      2)
        return 1
        ;;
      *)
        echo "[WARN] 仅支持 1 或 2。"
        ;;
    esac
  done
}

step4_verify_required_checks() {
  CURRENT_STEP="4"
  CURRENT_PHASE="step4.enter"
  save_state

  echo
  echo "== 步骤 4/6：执行必查项校验 =="

  local post_ext_count post_reg_count
  local ok_snapshot="no"
  local ok_registry="no"
  local ok_skill="no"

  post_ext_count="$(count_ext_blocks)"
  post_reg_count="$(count_registry_entries)"

  if [[ -n "$SNAPSHOT_FILE" && -f "$SNAPSHOT_FILE" ]]; then
    ok_snapshot="yes"
  fi

  if [[ "$post_reg_count" -gt "$PRE_REG_COUNT" ]]; then
    ok_registry="yes"
  fi

  if [[ "$post_ext_count" -gt "$PRE_EXT_COUNT" ]]; then
    ok_skill="yes"
  fi

  echo "- applied 快照: $ok_snapshot"
  echo "- registry 追加: $ok_registry"
  echo "- SKILL 扩展块追加: $ok_skill"

  if [[ "$ok_snapshot" == "yes" && "$ok_registry" == "yes" && "$ok_skill" == "yes" ]]; then
    echo "[OK] 必查项全部通过。"
    save_state
    return 0
  fi

  echo "[ERROR] 必查项未全部通过。"
  while true; do
    clear_for_choice
    echo
    echo "== 步骤 4/6：执行必查项校验 =="
    echo "[ERROR] 必查项未全部通过。"
    echo "- applied 快照: $ok_snapshot"
    echo "- registry 追加: $ok_registry"
    echo "- SKILL 扩展块追加: $ok_skill"
    echo "1. 回到需求文档编辑步骤"
    echo "2. 回到扩展集成步骤"
    CURRENT_PHASE="step4.failed_fallback_choice"
    save_state
    read -r -p "请输入 1 或 2: " fallback_choice
    case "$fallback_choice" in
      1)
        CURRENT_STEP="2"
        save_state
        return 1
        ;;
      2)
        CURRENT_STEP="3"
        save_state
        return 1
        ;;
      *)
        echo "[WARN] 仅支持 1 或 2。"
        ;;
    esac
  done
}

step5_optional_validation() {
  CURRENT_STEP="5"
  CURRENT_PHASE="step5.enter"
  save_state

  echo
  echo "== 步骤 5/6：按需验证 =="

  while true; do
    clear_for_choice
    echo
    echo "== 步骤 5/6：按需验证 =="
    echo "本次扩展是否涉及脚本行为或流程改造？"
    echo "1. 是，执行验证"
    echo "2. 否，跳过"
    CURRENT_PHASE="step5.need_validation_choice"
    save_state
    read -r -p "请输入 1 或 2: " validate_choice
    case "$validate_choice" in
      1)
        NEED_VALIDATION="yes"
        save_state
        echo "[INFO] 运行结构校验：python3 scripts/quick_validate.py ."
	        while true; do
	          if (cd "$ROOT_DIR" && python3 scripts/quick_validate.py .); then
	            break
	          fi
	          clear_for_choice
	          echo
	          echo "== 步骤 5/6：按需验证 =="
	          echo "[ERROR] quick_validate 失败。"
          echo "1. 重试 quick_validate"
          echo "2. 跳过该校验并继续"
          CURRENT_PHASE="step5.quick_validate_failed_choice"
          save_state
          read -r -p "请输入 1 或 2: " quick_validate_choice
          case "$quick_validate_choice" in
            1) ;;
            2) break ;;
            *) echo "[WARN] 仅支持 1 或 2。" ;;
          esac
        done

        echo
        echo "可继续输入额外验证命令（逐条执行，直接回车结束）："
        while true; do
          CURRENT_PHASE="step5.custom_validation_input"
          save_state
          read -r -p "验证命令> " custom_cmd
          if [[ -z "$custom_cmd" ]]; then
            break
          fi
          echo "[INFO] 执行：$custom_cmd"
	          while true; do
	            if (cd "$ROOT_DIR" && bash -lc "$custom_cmd"); then
	              break
	            fi
	            clear_for_choice
	            echo
	            echo "== 步骤 5/6：按需验证 =="
	            echo "[ERROR] 命令执行失败。"
            echo "1. 重试该命令"
            echo "2. 忽略失败并继续下一条"
            CURRENT_PHASE="step5.custom_validation_failed_choice"
            save_state
            read -r -p "请输入 1 或 2: " cmd_fail_choice
            case "$cmd_fail_choice" in
              1) ;;
              2) break ;;
              *) echo "[WARN] 仅支持 1 或 2。" ;;
            esac
          done
        done
        save_state
        return 0
        ;;
      2)
        NEED_VALIDATION="no"
        save_state
        echo "[INFO] 已跳过按需验证。"
        return 0
        ;;
      *)
        echo "[WARN] 仅支持 1 或 2。"
        ;;
    esac
  done
}

step6_finish() {
  CURRENT_STEP="6"
  CURRENT_PHASE="step6.finish"
  save_state

  echo
  echo "== 步骤 6/6：完成 =="
  echo "本次扩展已完成主要流程。"
  echo "- 需求文件: $EXT_FILE_REL"
  if [[ -n "$SNAPSHOT_FILE" ]]; then
    echo "- 快照文件: $SNAPSHOT_FILE"
  fi
  echo "- 来源 source: $SOURCE"
  echo
  echo "建议你再人工复核以下命令输出："
  echo "  tail -n 30 extensions/registry.md"
  echo "  tail -n 80 SKILL.md"

  STATUS="COMPLETED"
  save_state
  cleanup_state
  echo "[OK] 流程结束，缓存已清理。"
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    show_help
    exit 0
  fi

  trap on_exit EXIT
  trap on_interrupt INT TERM

  choose_entry_action
  WORKFLOW_ACTIVE="yes"
  enforce_resume_choice_if_needed

  while true; do
    case "$CURRENT_STEP" in
      1)
        if step1_collect_metadata; then
          CURRENT_STEP="2"
          save_state
        fi
        ;;
      2)
        if step2_edit_requirement_file; then
          CURRENT_STEP="3"
          save_state
        fi
        ;;
      3)
        if step3_integrate_extension; then
          CURRENT_STEP="4"
          save_state
        fi
        ;;
      4)
        if step4_verify_required_checks; then
          CURRENT_STEP="5"
          save_state
        fi
        ;;
      5)
        if step5_optional_validation; then
          CURRENT_STEP="6"
          save_state
        fi
        ;;
      6)
        step6_finish
        exit 0
        ;;
      *)
        echo "[ERROR] 未知步骤: $CURRENT_STEP"
        echo "[INFO] 将重置为步骤 1。"
        CURRENT_STEP="1"
        save_state
        ;;
    esac
  done
}

main "$@"
