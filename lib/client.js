// dsh-version-update — 浏览器半。
// 在「设置 → 通用设置」注册一行「版本」：显示当前版本 + 「检查更新」按钮，
// 发现新版本时出现「立即更新」按钮，点击后把「升级 + 重启」命令复制到剪贴板，
// 并弹 toast 提示到终端粘贴执行。中英双语，跟随主题变量。

window.__ModuleLoader__.load({
	id: "dsh-version-update",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { useState, useEffect } = React;

		const CHECK_PATH = "/api/version/check";
		const UPDATE_PATH = "/api/version/update";
		const TOAST_MS = 6000;

		const STRINGS = {
			zh: {
				title: "版本",
				current: "当前版本",
				check: "检查更新",
				checking: "检查中…",
				upToDate: "已是最新版本",
				updateAvailable: "发现新版本",
				checkFailed: "检查更新失败",
				update: "立即更新",
				copying: "复制中…",
				copied: "升级命令已复制，请到终端粘贴执行",
				copyToast: "升级命令已复制，请到终端粘贴执行（先 Ctrl+C 停掉当前 dsh）",
				updateFailed: "复制失败"
			},
			en: {
				title: "Version",
				current: "Current version",
				check: "Check for updates",
				checking: "Checking…",
				upToDate: "Up to date",
				updateAvailable: "New version available",
				checkFailed: "Update check failed",
				update: "Update now",
				copying: "Copying…",
				copied: "Update command copied — paste it in your terminal to complete",
				copyToast: "Update command copied — paste it in your terminal to complete (Ctrl+C to stop the current dsh first)",
				updateFailed: "Copy failed"
			}
		};

		const CSS = [
			".dshv-row{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}",
			".dshv-row:last-child{border-bottom:none}",
			".dshv-text{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}",
			".dshv-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".dshv-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;min-height:18px}",
			".dshv-up{color:var(--dsw-alias-state-success-primary)}",
			".dshv-new{color:var(--dsw-alias-brand-primary)}",
			".dshv-err{color:var(--dsw-alias-state-error-primary)}",
			".dshv-actions{flex-direction:column;align-items:flex-end;gap:8px;display:flex;flex:none}",
			".dshv-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:18px;height:36px;padding:0 14px;font:inherit;font-size:14px;line-height:22px;flex:none;white-space:nowrap}",
			".dshv-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dshv-btn:disabled{opacity:0.6;cursor:default}",
			".dshv-btn-primary{background:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}",
			".dshv-btn-primary:hover:not(:disabled){opacity:0.85}",
			".dshv-cmd{margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);word-break:break-all;user-select:all}",
			".dshv-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 16px;font-size:13px;line-height:20px;box-shadow:0 8px 30px rgba(0,0,0,.2);z-index:2147483000;max-width:min(520px,calc(100vw - 48px));white-space:normal}"
		].join("");

		// ---- 轻量 toast（模块级发布/订阅）----
		let toastState = { message: null, nonce: 0 };
		const toastListeners = new Set();
		let toastTimer = null;

		function notifyToast(message) {
			toastState = { message, nonce: toastState.nonce + 1 };
			toastListeners.forEach((fn) => fn(toastState));
			if (toastTimer) clearTimeout(toastTimer);
			toastTimer = setTimeout(() => {
				toastState = { message: null, nonce: toastState.nonce + 1 };
				toastListeners.forEach((fn) => fn(toastState));
			}, TOAST_MS);
		}

		/** 跟随 harness 语言，订阅 locale 变化以便重渲染。 */
		function useLang(locale) {
			const [lang, setLang] = useState(() => (
				locale && typeof locale.getSnapshot === "function" ? locale.getSnapshot().active : "zh"
			));
			useEffect(() => {
				if (!locale || typeof locale.subscribe !== "function") return undefined;
				const unsub = locale.subscribe(() => setLang(locale.getSnapshot().active));
				return unsub;
			}, [locale]);
			return lang === "en" ? "en" : "zh";
		}

		function makeRow(locale) {
			return function VersionRow() {
				const lang = useLang(locale);
				const t = (k) => (STRINGS[lang] && STRINGS[lang][k]) || STRINGS.zh[k] || k;

				const [current, setCurrent] = useState("");
				const [phase, setPhase] = useState("idle");
				const [latest, setLatest] = useState(null);
				const [detail, setDetail] = useState(null);
				const [command, setCommand] = useState(null);

				useEffect(() => {
					let alive = true;
					fetch(CHECK_PATH, { cache: "no-store" })
						.then((r) => r.json())
						.then((res) => {
							if (alive && res && typeof res.current === "string") setCurrent(res.current);
						})
						.catch(() => {});
					return () => { alive = false; };
				}, []);

				const busy = phase === "checking" || phase === "copying";

				const onCheck = async () => {
					if (busy) return;
					setPhase("checking");
					setDetail(null);
					setLatest(null);
					try {
						const res = await fetch(CHECK_PATH, { cache: "no-store" }).then((r) => r.json());
						if (res && !res.error) {
							setLatest(typeof res.latest === "string" ? res.latest : null);
							setPhase(res.upToDate === true ? "upToDate" : "updateAvailable");
						} else {
							setDetail((res && typeof res.error === "string" && res.error !== "") ? res.error : "unknown error");
							setPhase("checkError");
						}
					} catch (err) {
						setDetail(err && err.message ? err.message : String(err));
						setPhase("checkError");
					}
				};

				const onUpdate = async () => {
					if (busy) return;
					setPhase("copying");
					setDetail(null);
					setCommand(null);
					try {
						const url = latest ? `${UPDATE_PATH}?version=${encodeURIComponent(latest)}` : UPDATE_PATH;
						const res = await fetch(url, { method: "POST", cache: "no-store" }).then((r) => r.json());
						if (res && res.ok === true) {
							setCommand(typeof res.command === "string" ? res.command : null);
							setPhase("copied");
							notifyToast(t("copyToast"));
						} else {
							setCommand((res && typeof res.command === "string") ? res.command : null);
							setDetail((res && typeof res.error === "string" && res.error !== "") ? res.error : "unknown error");
							setPhase("updateError");
						}
					} catch (err) {
						setDetail(err && err.message ? err.message : String(err));
						setPhase("updateError");
					}
				};

				const sub = [];
				sub.push(React.createElement("div", { key: "cur", className: "dshv-sub" },
					current ? `${t("current")} v${current}` : ""
				));
				if (phase === "upToDate") {
					sub.push(React.createElement("div", { key: "status", className: "dshv-sub dshv-up" }, t("upToDate")));
				} else if (phase === "updateAvailable") {
					sub.push(React.createElement("div", { key: "status", className: "dshv-sub dshv-new" },
						t("updateAvailable") + (latest ? ` v${latest}` : "")
					));
				} else if (phase === "checkError") {
					sub.push(React.createElement("div", { key: "status", className: "dshv-sub dshv-err" },
						`${t("checkFailed")}${detail ? `: ${detail}` : ""}`
					));
				} else if (phase === "copying") {
					sub.push(React.createElement("div", { key: "status", className: "dshv-sub" }, t("copying")));
				} else if (phase === "copied") {
					sub.push(React.createElement("div", { key: "status", className: "dshv-sub dshv-up" }, t("copied")));
					if (command) sub.push(React.createElement("div", { key: "cmd", className: "dshv-cmd" }, command));
				} else if (phase === "updateError") {
					sub.push(React.createElement("div", { key: "status", className: "dshv-sub dshv-err" },
						`${t("updateFailed")}${detail ? `: ${detail}` : ""}`
					));
					if (command) sub.push(React.createElement("div", { key: "cmd", className: "dshv-cmd" }, command));
				}

				const showUpdate = phase === "updateAvailable" || phase === "updateError" || phase === "copying";
				const actions = [];
				if (showUpdate) {
					actions.push(React.createElement("button", {
						key: "update",
						type: "button",
						className: "dshv-btn dshv-btn-primary",
						onClick: onUpdate,
						disabled: busy
					}, phase === "copying" ? t("copying") : t("update")));
				}
				actions.push(React.createElement("button", {
					key: "check",
					type: "button",
					className: "dshv-btn",
					onClick: onCheck,
					disabled: busy
				}, phase === "checking" ? t("checking") : t("check")));

				return React.createElement("div", { className: "dshv-row" },
					React.createElement("div", { className: "dshv-text" },
						React.createElement("div", { className: "dshv-title" }, t("title")),
						sub
					),
					React.createElement("div", { className: "dshv-actions" }, actions)
				);
			};
		}

		function makeToast() {
			return function Toast() {
				const [state, setState] = useState(toastState);
				useEffect(() => {
					const fn = (next) => setState(next);
					toastListeners.add(fn);
					return () => { toastListeners.delete(fn); };
				}, []);
				if (!state.message) return null;
				return React.createElement("div", { className: "dshv-toast", role: "status" }, state.message);
			};
		}

		// ---- 客户端插件主体 ----------------------------------------
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-version-update";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					if (style.parentNode) style.parentNode.removeChild(style);
				};
			}, "dsh-version-update: styles");

			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "version-update-toast",
				order: 1000
			}, makeToast()));

			const row = makeRow(ctx.locale);
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "version",
				order: 30
			}, row));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
