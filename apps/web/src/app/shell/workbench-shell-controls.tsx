import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppLocale } from "../../i18n/use-i18n";
import { BoltIcon, CheckIcon } from "./workbench-icons";

export type ComposerDropdownOption<T extends string> = {
  value: T;
  label: string;
  testIdSuffix?: string;
  icon?: ReactNode;
};

export type ComposerSpeedMode = "standard" | "fast";

export function ComposerInlineDropdown<T extends string>(props: {
  className?: string;
  testId: string;
  icon?: ReactNode;
  ariaLabel?: string;
  iconOnly?: boolean;
  value: T;
  label: string;
  options: Array<ComposerDropdownOption<T>>;
  menuTitle?: string;
  menuPlacement?: "above" | "below";
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={[
        "composer-inline-select",
        props.className ?? "",
        open ? "composer-inline-select--open" : "",
        props.iconOnly ? "composer-inline-select--icon-only" : "",
        props.menuPlacement === "below" ? "composer-inline-select--below" : "",
        props.disabled ? "composer-inline-select--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="composer-inline-select__trigger"
        data-testid={props.testId}
        data-value={props.value}
        aria-label={props.ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {props.icon ? <span className="composer-inline-select__icon">{props.icon}</span> : null}
        <span className="composer-inline-select__label">{props.label}</span>
        <span className="composer-inline-select__chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="composer-inline-select__menu" role="menu" data-testid={`${props.testId}-menu`}>
          {props.menuTitle ? (
            <div className="composer-inline-select__menu-title">{props.menuTitle}</div>
          ) : null}
          {props.options.map((option) => {
            const selected = option.value === props.value;
            return (
              <button
                key={(option.testIdSuffix ?? option.value) || "default"}
                type="button"
                role="menuitemradio"
                className="composer-inline-select__option"
                data-selected={selected ? "true" : "false"}
                data-testid={`${props.testId}-option-${(option.testIdSuffix ?? option.value) || "default"}`}
                aria-checked={selected ? "true" : "false"}
                onClick={() => {
                  setOpen(false);
                  props.onChange(option.value);
                }}
              >
                {option.icon ? (
                  <span className="composer-inline-select__option-icon" aria-hidden="true">
                    {option.icon}
                  </span>
                ) : null}
                <span className="composer-inline-select__option-label">{option.label}</span>
                {selected ? (
                  <span className="composer-inline-select__option-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ComposerSpeedSwitch(props: {
  className?: string;
  mode: ComposerSpeedMode;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useAppLocale();
  const fast = props.mode === "fast";

  return (
    <div
      className={[
        "composer-speed-switch",
        props.className ?? "",
        fast ? "composer-speed-switch--fast" : "",
        props.disabled ? "composer-speed-switch--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="composer-speed-switch__value">
        {fast ? t("composer.speedFast") : t("composer.speedStandard")}
      </span>
      <button
        type="button"
        className="composer-speed-switch__control"
        data-testid="composer-speed-switch"
        role="switch"
        aria-label={t("composer.switchSpeedAria")}
        aria-checked={fast ? "true" : "false"}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        <span className="composer-speed-switch__track" aria-hidden="true">
          <span className="composer-speed-switch__thumb">
            <BoltIcon />
          </span>
        </span>
      </button>
    </div>
  );
}
