import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../ui/input-group";
import { Button } from "../ui/button";
import { resolveConversationFindKeyAction } from "./conversationFindMatches";

export function ConversationFindBar({
  query,
  onQueryChange,
  matchCount,
  activeMatchNumber,
  onNext,
  onPrevious,
  onClose,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  /** 1-based position of the active match, or null when there are no matches. */
  activeMatchNumber: number | null;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="dialog-glass absolute top-3 right-3 z-30 w-72 rounded-xl border p-1.5 shadow-lg"
      data-conversation-find-bar
      onKeyDown={(event) => {
        // Attached to the whole bar (not just the input) so Escape still
        // closes it after focus has moved to the prev/next/close buttons.
        const action = resolveConversationFindKeyAction(event);
        if (!action) return;
        event.preventDefault();
        if (action === "next") onNext();
        else if (action === "previous") onPrevious();
        else onClose();
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          aria-label="Find in conversation"
          placeholder="Find in conversation"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="tabular-nums">
            {matchCount === 0 ? "No results" : `${activeMatchNumber ?? 0}/${matchCount}`}
          </InputGroupText>
          <Button
            aria-label="Previous match"
            disabled={matchCount === 0}
            onClick={onPrevious}
            size="icon-xs"
            type="button"
            variant="ghost-muted"
          >
            <ChevronUpIcon />
          </Button>
          <Button
            aria-label="Next match"
            disabled={matchCount === 0}
            onClick={onNext}
            size="icon-xs"
            type="button"
            variant="ghost-muted"
          >
            <ChevronDownIcon />
          </Button>
          <Button
            aria-label="Close find bar"
            onClick={onClose}
            size="icon-xs"
            type="button"
            variant="ghost-muted"
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
