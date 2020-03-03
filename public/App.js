'use strict';

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function custom_event(type, detail) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, false, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error(`Function called outside component initialization`);
    return current_component;
}
function beforeUpdate(fn) {
    get_current_component().$$.before_update.push(fn);
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function tick() {
    schedule_update();
    return resolved_promise;
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
function flush() {
    const seen_callbacks = new Set();
    do {
        // first, call beforeUpdate functions
        // and update components
        while (dirty_components.length) {
            const component = dirty_components.shift();
            set_current_component(component);
            update(component.$$);
        }
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                callback();
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}

// source: https://html.spec.whatwg.org/multipage/indices.html
const boolean_attributes = new Set([
    'allowfullscreen',
    'allowpaymentrequest',
    'async',
    'autofocus',
    'autoplay',
    'checked',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'hidden',
    'ismap',
    'loop',
    'multiple',
    'muted',
    'nomodule',
    'novalidate',
    'open',
    'playsinline',
    'readonly',
    'required',
    'reversed',
    'selected'
]);

const invalid_attribute_name_character = /[\s'">/=\u{FDD0}-\u{FDEF}\u{FFFE}\u{FFFF}\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u;
// https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
// https://infra.spec.whatwg.org/#noncharacter
function spread(args, classes_to_add) {
    const attributes = Object.assign({}, ...args);
    if (classes_to_add) {
        if (attributes.class == null) {
            attributes.class = classes_to_add;
        }
        else {
            attributes.class += ' ' + classes_to_add;
        }
    }
    let str = '';
    Object.keys(attributes).forEach(name => {
        if (invalid_attribute_name_character.test(name))
            return;
        const value = attributes[name];
        if (value === true)
            str += " " + name;
        else if (boolean_attributes.has(name.toLowerCase())) {
            if (value)
                str += " " + name;
        }
        else if (value != null) {
            str += ` ${name}="${String(value).replace(/"/g, '&#34;').replace(/'/g, '&#39;')}"`;
        }
    });
    return str;
}
const escaped = {
    '"': '&quot;',
    "'": '&#39;',
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
};
function escape(html) {
    return String(html).replace(/["'&<>]/g, match => escaped[match]);
}
function each(items, fn) {
    let str = '';
    for (let i = 0; i < items.length; i += 1) {
        str += fn(items[i], i);
    }
    return str;
}
const missing_component = {
    $$render: () => ''
};
function validate_component(component, name) {
    if (!component || !component.$$render) {
        if (name === 'svelte:component')
            name += ' this={...}';
        throw new Error(`<${name}> is not a valid SSR component. You may need to review your build config to ensure that dependencies are compiled, rather than imported as pre-compiled modules`);
    }
    return component;
}
let on_destroy;
function create_ssr_component(fn) {
    function $$render(result, props, bindings, slots) {
        const parent_component = current_component;
        const $$ = {
            on_destroy,
            context: new Map(parent_component ? parent_component.$$.context : []),
            // these will be immediately discarded
            on_mount: [],
            before_update: [],
            after_update: [],
            callbacks: blank_object()
        };
        set_current_component({ $$ });
        const html = fn(result, props, bindings, slots);
        set_current_component(parent_component);
        return html;
    }
    return {
        render: (props = {}, options = {}) => {
            on_destroy = [];
            const result = { title: '', head: '', css: new Set() };
            const html = $$render(result, props, {}, options);
            run_all(on_destroy);
            return {
                html,
                css: {
                    code: Array.from(result.css).map(css => css.code).join('\n'),
                    map: null // TODO
                },
                head: result.title + result.head
            };
        },
        $$render
    };
}
function add_attribute(name, value, boolean) {
    if (value == null || (boolean && !value))
        return '';
    return ` ${name}${value === true ? '' : `=${typeof value === 'string' ? JSON.stringify(escape(value)) : `"${value}"`}`}`;
}

const subscriber_queue = [];
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (let i = 0; i < subscribers.length; i += 1) {
                    const s = subscribers[i];
                    s[1]();
                    subscriber_queue.push(s, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}

const notification = writable();

/* node_modules/@beyonk/svelte-notifications/src/Notifications.svelte generated by Svelte v3.17.1 */

const css = {
	code: ".toasts{list-style:none;position:fixed;top:0;right:0;padding:0;margin:0;z-index:9999}.svelte-1ggskci.svelte-1ggskci.toasts>.toast.svelte-1ggskci.svelte-1ggskci{position:relative;margin:10px;min-width:40vw;position:relative;animation:svelte-1ggskci-animate-in 350ms forwards;color:#fff}.svelte-1ggskci.toasts>.toast.svelte-1ggskci>.content.svelte-1ggskci{padding:10px;display:block;font-weight:500}.svelte-1ggskci.toasts>.toast.svelte-1ggskci>.progress.svelte-1ggskci{position:absolute;bottom:0;background-color:rgb(0, 0, 0, 0.3);height:6px;width:100%;animation-name:svelte-1ggskci-shrink;animation-timing-function:linear;animation-fill-mode:forwards}.svelte-1ggskci.svelte-1ggskci.toasts>.toast.svelte-1ggskci.svelte-1ggskci:before,.svelte-1ggskci.svelte-1ggskci.toasts>.toast.svelte-1ggskci.svelte-1ggskci:after{content:\"\";position:absolute;z-index:-1;top:50%;bottom:0;left:10px;right:10px;border-radius:100px / 10px}.svelte-1ggskci.svelte-1ggskci.toasts>.toast.svelte-1ggskci.svelte-1ggskci:after{right:10px;left:auto;transform:skew(8deg) rotate(3deg)}@keyframes svelte-1ggskci-animate-in{0%{width:0;opacity:0;transform:scale(1.15) translateY(20px)}100%{width:40vw;opacity:1;transform:scale(1) translateY(0)}}@keyframes svelte-1ggskci-shrink{0%{width:40vw}100%{width:0}}",
	map: "{\"version\":3,\"file\":\"Notifications.svelte\",\"sources\":[\"Notifications.svelte\"],\"sourcesContent\":[\"<ul class=\\\"toasts\\\">\\n\\t{#each toasts as toast (toast.id)}\\n\\t\\t<li class=\\\"toast\\\" style=\\\"background: {toast.background};\\\" out:animateOut>\\n\\t\\t\\t<div class=\\\"content\\\">\\n\\t\\t\\t\\t{toast.msg}\\n\\t\\t\\t</div>\\n\\t\\t\\t<div \\n        class=\\\"progress\\\" \\n        style=\\\"animation-duration: {toast.timeout}ms;\\\"\\n        on:animationend={() => removeToast(toast.id) }>\\n\\t\\t\\t</div>\\n\\t\\t</li>\\t\\n\\t{/each}\\n</ul>\\n\\n<style>\\n\\t:global(.toasts) {\\n\\t\\tlist-style: none;\\n\\t\\tposition: fixed;\\n\\t\\ttop: 0;\\n\\t\\tright: 0;\\n\\t\\tpadding: 0;\\n\\t\\tmargin: 0;\\n\\t\\tz-index: 9999;\\n\\t}\\n\\t\\n\\t:global(.toasts) > .toast {\\n\\t\\tposition: relative;\\n\\t\\tmargin: 10px;\\n\\t\\tmin-width: 40vw;\\n\\t\\tposition: relative;\\n\\t\\tanimation: animate-in 350ms forwards;\\n\\t\\tcolor: #fff;\\n\\t}\\n\\t\\n\\t:global(.toasts) > .toast > .content {\\n\\t\\tpadding: 10px;\\n\\t\\tdisplay: block;\\n\\t\\tfont-weight: 500;\\n\\t}\\n\\t\\n\\t:global(.toasts) > .toast > .progress {\\n\\t\\tposition: absolute;\\n\\t\\tbottom: 0;\\n\\t\\tbackground-color: rgb(0, 0, 0, 0.3);\\n\\t\\theight: 6px;\\n    width: 100%;\\n\\t  animation-name: shrink;\\n\\t  animation-timing-function: linear;\\n\\t  animation-fill-mode: forwards;\\n\\t}\\n\\t\\n\\t:global(.toasts) > .toast:before,\\n\\t:global(.toasts) > .toast:after {\\n\\t\\t\\tcontent:\\\"\\\";\\n\\t\\t\\tposition:absolute;\\n\\t\\t\\tz-index:-1;\\n\\t\\t\\ttop:50%;\\n\\t\\t\\tbottom:0;\\n\\t\\t\\tleft:10px;\\n\\t\\t\\tright:10px;\\n\\t\\t\\tborder-radius:100px / 10px;\\n\\t}\\n\\t\\n\\t:global(.toasts) > .toast:after {\\n\\t\\t\\tright:10px;\\n\\t\\t\\tleft:auto;\\n\\t\\t\\ttransform:skew(8deg) rotate(3deg);\\n\\t}\\n\\t\\n\\t@keyframes animate-in { \\n\\t\\t0% { \\n\\t\\t\\twidth: 0; \\n\\t\\t\\topacity: 0; \\n\\t\\t\\ttransform: scale(1.15) translateY(20px);\\n\\t\\t}\\n\\t\\t100% { \\n\\t\\t\\twidth: 40vw;\\n\\t\\t\\topacity: 1; \\n\\t\\t\\ttransform: scale(1) translateY(0);\\n\\t\\t}\\n\\t}\\n\\t\\n\\t@keyframes shrink { \\n\\t\\t0% { \\n\\t\\t\\twidth: 40vw; \\n\\t\\t}\\n\\t\\t100% { \\n\\t\\t\\twidth: 0; \\n\\t\\t}\\n\\t}\\n\\t\\n</style>\\n\\n<script>\\n  import { notification } from './store.js'\\n  import { onMount, onDestroy } from 'svelte'\\n\\n\\texport let themes = {\\n\\t\\tdanger: '#bb2124',\\n\\t\\tsuccess: '#22bb33',\\n\\t\\twarning: '#f0ad4e',\\n\\t\\tinfo: '#5bc0de',\\n\\t\\tdefault: '#aaaaaa'\\n  }\\n\\n  export let timeout = 3000\\n\\n\\tlet count = 0\\n\\tlet toasts = [ ]\\n  let unsubscribe\\n\\n\\tfunction animateOut(node, { delay = 0, duration = 300 }) {\\n\\t\\tfunction vhTOpx (value) {\\n\\t\\t\\tvar w = window,\\n\\t\\t\\t\\td = document,\\n\\t\\t\\t\\te = d.documentElement,\\n\\t\\t\\t\\tg = d.getElementsByTagName('body')[0],\\n\\t\\t\\t\\tx = w.innerWidth || e.clientWidth || g.clientWidth,\\n\\t\\t\\t\\ty = w.innerHeight|| e.clientHeight|| g.clientHeight;\\n\\n\\t\\t\\treturn (y*value)/100;\\n\\t\\t}\\n\\t\\t\\n\\t\\treturn {\\n\\t\\t\\tdelay,\\n\\t\\t\\tduration,\\n\\t\\t\\tcss: t => `opacity: ${(t-.5) * 1}; transform-origin: top right; transform: scaleX(${(t-.5)*1});`\\n\\t\\t}\\n\\t}\\n\\n\\tfunction createToast (msg, theme, to) {\\n\\t\\tconst background = themes[theme] || themes['default']\\n\\t\\ttoasts = [{\\n\\t\\t\\tid: count,\\n\\t\\t\\tmsg, \\n\\t\\t\\tbackground, \\n\\t\\t\\ttimeout: to || timeout,\\n\\t\\t\\twidth: '100%'\\n\\t\\t}, ...toasts];\\n\\t\\tcount = count + 1\\n  }\\n  \\n  unsubscribe = notification.subscribe(value => {\\n    if (!value) { return }\\n    createToast(value.message, value.type, value.timeout)\\n    notification.set()\\n  })\\n  \\n  onDestroy(unsubscribe)\\n\\t\\n\\tfunction removeToast (id) { \\n\\t\\ttoasts = toasts.filter(t => t.id != id)\\n\\t}\\n</script>\\n\"],\"names\":[],\"mappings\":\"AAgBS,OAAO,AAAE,CAAC,AACjB,UAAU,CAAE,IAAI,CAChB,QAAQ,CAAE,KAAK,CACf,GAAG,CAAE,CAAC,CACN,KAAK,CAAE,CAAC,CACR,OAAO,CAAE,CAAC,CACV,MAAM,CAAE,CAAC,CACT,OAAO,CAAE,IAAI,AACd,CAAC,8BAEO,OAAO,AAAC,CAAG,MAAM,8BAAC,CAAC,AAC1B,QAAQ,CAAE,QAAQ,CAClB,MAAM,CAAE,IAAI,CACZ,SAAS,CAAE,IAAI,CACf,QAAQ,CAAE,QAAQ,CAClB,SAAS,CAAE,yBAAU,CAAC,KAAK,CAAC,QAAQ,CACpC,KAAK,CAAE,IAAI,AACZ,CAAC,eAEO,OAAO,AAAC,CAAG,qBAAM,CAAG,QAAQ,eAAC,CAAC,AACrC,OAAO,CAAE,IAAI,CACb,OAAO,CAAE,KAAK,CACd,WAAW,CAAE,GAAG,AACjB,CAAC,eAEO,OAAO,AAAC,CAAG,qBAAM,CAAG,SAAS,eAAC,CAAC,AACtC,QAAQ,CAAE,QAAQ,CAClB,MAAM,CAAE,CAAC,CACT,gBAAgB,CAAE,IAAI,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,GAAG,CAAC,CACnC,MAAM,CAAE,GAAG,CACT,KAAK,CAAE,IAAI,CACZ,cAAc,CAAE,qBAAM,CACtB,yBAAyB,CAAE,MAAM,CACjC,mBAAmB,CAAE,QAAQ,AAC/B,CAAC,8BAEO,OAAO,AAAC,CAAG,oCAAM,OAAO,+BACxB,OAAO,AAAC,CAAG,oCAAM,MAAM,AAAC,CAAC,AAC/B,QAAQ,EAAE,CACV,SAAS,QAAQ,CACjB,QAAQ,EAAE,CACV,IAAI,GAAG,CACP,OAAO,CAAC,CACR,KAAK,IAAI,CACT,MAAM,IAAI,CACV,cAAc,KAAK,CAAC,CAAC,CAAC,IAAI,AAC5B,CAAC,8BAEO,OAAO,AAAC,CAAG,oCAAM,MAAM,AAAC,CAAC,AAC/B,MAAM,IAAI,CACV,KAAK,IAAI,CACT,UAAU,KAAK,IAAI,CAAC,CAAC,OAAO,IAAI,CAAC,AACnC,CAAC,AAED,WAAW,yBAAW,CAAC,AACtB,EAAE,AAAC,CAAC,AACH,KAAK,CAAE,CAAC,CACR,OAAO,CAAE,CAAC,CACV,SAAS,CAAE,MAAM,IAAI,CAAC,CAAC,WAAW,IAAI,CAAC,AACxC,CAAC,AACD,IAAI,AAAC,CAAC,AACL,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,CAAC,CACV,SAAS,CAAE,MAAM,CAAC,CAAC,CAAC,WAAW,CAAC,CAAC,AAClC,CAAC,AACF,CAAC,AAED,WAAW,qBAAO,CAAC,AAClB,EAAE,AAAC,CAAC,AACH,KAAK,CAAE,IAAI,AACZ,CAAC,AACD,IAAI,AAAC,CAAC,AACL,KAAK,CAAE,CAAC,AACT,CAAC,AACF,CAAC\"}"
};

const Notifications = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { themes = {
		danger: "#bb2124",
		success: "#22bb33",
		warning: "#f0ad4e",
		info: "#5bc0de",
		default: "#aaaaaa"
	} } = $$props;

	let { timeout = 3000 } = $$props;
	let count = 0;
	let toasts = [];
	let unsubscribe;

	function createToast(msg, theme, to) {
		const background = themes[theme] || themes["default"];

		toasts = [
			{
				id: count,
				msg,
				background,
				timeout: to || timeout,
				width: "100%"
			},
			...toasts
		];

		count = count + 1;
	}

	unsubscribe = notification.subscribe(value => {
		if (!value) {
			return;
		}

		createToast(value.message, value.type, value.timeout);
		notification.set();
	});

	onDestroy(unsubscribe);

	if ($$props.themes === void 0 && $$bindings.themes && themes !== void 0) $$bindings.themes(themes);
	if ($$props.timeout === void 0 && $$bindings.timeout && timeout !== void 0) $$bindings.timeout(timeout);
	$$result.css.add(css);

	return `<ul class="${"toasts svelte-1ggskci"}">
	${each(toasts, toast => `<li class="${"toast svelte-1ggskci"}" style="${"background: " + escape(toast.background) + ";"}">
			<div class="${"content svelte-1ggskci"}">
				${escape(toast.msg)}
			</div>
			<div class="${"progress svelte-1ggskci"}" style="${"animation-duration: " + escape(toast.timeout) + "ms;"}">
			</div>
		</li>`)}
</ul>`;
});

function send (message, type = 'default', timeout) {
  notification.set({ type, message, timeout });
}

function success (msg, timeout) {
  send(msg, 'success', timeout);
}

const ENVIRONMENTS = ["dev", "qa", "stag", "prod", "us2", "us1"];
const FORM_STEPS = ["promote", "pick-related", "confirm"];

class FormState {
  constructor() {
    this.currentStep = writable(0);
    this.selectedAssets = writable([]);
    this.assets = writable([]);
    this.environment = writable(null);
    this.unsubscribeCallbacks = [];
  }

  subscribe(callback) {
    const { assets, currentStep, environment, selectedAssets, unsubscribeCallbacks } = this;
    unsubscribeCallbacks.push(assets.subscribe((value) => callback("assets", value)));
    unsubscribeCallbacks.push(environment.subscribe((value) => callback("environment", value)));
    unsubscribeCallbacks.push(currentStep.subscribe((value) => callback("currentStep", value)));
    unsubscribeCallbacks.push(selectedAssets.subscribe((value) => callback("selectedAssets", value)));
  }

  unsubscribe() {
    this.unsubscribeCallbacks.forEach(unsub => unsub());
  }

  reset() {
    this.currentStep.set(0);
    this.selectedAssets.set([]);
    this.environment.set(null);
  }

  nextStep() {
    return this.currentStep.update(n => n < FORM_STEPS.length - 1 ? n + 1 : n)
  }

  previousStep() {
    return this.currentStep.update(n => n > 0 ? n - 1 : n)
  }

  setSelectedAssets(rows) {
    return this.selectedAssets.set(rows);
  }

  setAssets(rows) {
    return this.assets.set(rows);
  }

  setEnvironment(env) {
    this.environment.set(env);
  }
}

const formState = new FormState();

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.substring(1);
}

const groupBy = (array, key) =>
  array.reduce(
    (objectsByKeyValue, obj) => ({
      ...objectsByKeyValue,
      [obj[key]]: (objectsByKeyValue[obj[key]] || []).concat(obj)
    }),
    {}
  );

/* src/components/Typography/Title.svelte generated by Svelte v3.17.1 */

const css$1 = {
	code: "h1.svelte-h6wfgu{font-weight:600;font-size:1.75em;line-height:1.5em;letter-spacing:0.025em;text-align:center}@media(max-width: 550px){h1.svelte-h6wfgu{font-size:1.35em}}",
	map: "{\"version\":3,\"file\":\"Title.svelte\",\"sources\":[\"Title.svelte\"],\"sourcesContent\":[\"<style>\\n  h1 {\\n    font-weight: 600;\\n    font-size: 1.75em;\\n    line-height: 1.5em;\\n    letter-spacing: 0.025em;\\n    text-align: center;\\n  }\\n\\n  @media (max-width: 550px) {\\n    h1 {\\n      font-size: 1.35em;\\n    }\\n  }\\n</style>\\n\\n<h1>\\n  <slot />\\n</h1>\\n\"],\"names\":[],\"mappings\":\"AACE,EAAE,cAAC,CAAC,AACF,WAAW,CAAE,GAAG,CAChB,SAAS,CAAE,MAAM,CACjB,WAAW,CAAE,KAAK,CAClB,cAAc,CAAE,OAAO,CACvB,UAAU,CAAE,MAAM,AACpB,CAAC,AAED,MAAM,AAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AACzB,EAAE,cAAC,CAAC,AACF,SAAS,CAAE,MAAM,AACnB,CAAC,AACH,CAAC\"}"
};

const Title = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	$$result.css.add(css$1);

	return `<h1 class="${"svelte-h6wfgu"}">
  ${$$slots.default ? $$slots.default({}) : ``}
</h1>`;
});

/* src/components/Table.svelte generated by Svelte v3.17.1 */

const css$2 = {
	code: ".table-container.svelte-1q8bbpf{max-width:815px;height:70vh;margin:0 auto;overflow-x:hidden}.ag-root{border:none !important}.ag-header{border-radius:1.1em;margin-bottom:10px;height:38px}.ag-center-cols-container::-webkit-scrollbar-thumb{border-radius:10px;box-shadow:inset 0 0 6px rgba(0, 0, 0, 0.3);background-color:#888}.ag-center-cols-container::-webkit-scrollbar{width:5px;background-color:transparent;box-shadow:none}@media screen and (max-width: 550px){.table-container.svelte-1q8bbpf{width:85vw;max-width:825px}}",
	map: "{\"version\":3,\"file\":\"Table.svelte\",\"sources\":[\"Table.svelte\"],\"sourcesContent\":[\"<script>\\n  import { onMount } from \\\"svelte\\\";\\n  import { capitalize } from \\\"util/index.js\\\";\\n  export let rows = [];\\n  export let onRowSelected;\\n  export let onUnselect;\\n  export let selectedRows = [];\\n\\n  $: columns =\\n    rows.length > 0\\n      ? Object.entries(rows[0]).map(([key], index) => ({\\n          field: key,\\n          headerName: capitalize(key),\\n          sortable: true,\\n          checkboxSelection: index == 0\\n        }))\\n      : [];\\n\\n  let gridOptions = {};\\n\\n  onMount(() => {\\n    document.addEventListener(\\\"DOMContentLoaded\\\", () => {\\n      gridOptions = {\\n        columnDefs: columns,\\n        rowData: rows,\\n        rowSelection: \\\"multiple\\\",\\n        rowMultiSelectWithClick: true,\\n        pagination: true,\\n        // animateRows: true,\\n        defaultColDef: {\\n          filter: true\\n        },\\n        onRowSelected: event => {\\n          if (onRowSelected && event.node.selected) {\\n            onRowSelected(gridOptions, event.node.data);\\n          }\\n        },\\n        onSelectionChanged: event => {\\n          const rowCount = event.api.getSelectedNodes().length;\\n          if (rowCount == 0) {\\n            gridOptions.api.setFilterModel(null);\\n            if (onUnselect) {\\n              onUnselect();\\n            }\\n          }\\n          selectedRows = event.api.getSelectedNodes();\\n        }\\n      };\\n      const gridDiv = document.querySelector(\\\"#table-container\\\");\\n      new agGrid.Grid(gridDiv, gridOptions);\\n    });\\n  });\\n\\n  $: {\\n    if (gridOptions && gridOptions.api) {\\n      gridOptions.api.setColumnDefs(columns);\\n      gridOptions.api.setRowData(rows);\\n    }\\n  }\\n</script>\\n\\n<style>\\n  .table-container {\\n    max-width: 815px;\\n    height: 70vh;\\n    margin: 0 auto;\\n    overflow-x: hidden;\\n  }\\n  :global(.ag-root) {\\n    border: none !important;\\n  }\\n  :global(.ag-header) {\\n    border-radius: 1.1em;\\n    margin-bottom: 10px;\\n    height: 38px;\\n  }\\n  :global(.ag-center-cols-container::-webkit-scrollbar-thumb) {\\n    border-radius: 10px;\\n    box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);\\n    background-color: #888;\\n  }\\n  :global(.ag-center-cols-container::-webkit-scrollbar) {\\n    width: 5px;\\n    background-color: transparent;\\n    box-shadow: none;\\n  }\\n\\n  @media screen and (max-width: 550px) {\\n    .table-container {\\n      width: 85vw;\\n      max-width: 825px;\\n    }\\n  }\\n</style>\\n\\n<div id=\\\"table-container\\\" class=\\\"table-container ag-theme-balham\\\" />\\n\"],\"names\":[],\"mappings\":\"AA8DE,gBAAgB,eAAC,CAAC,AAChB,SAAS,CAAE,KAAK,CAChB,MAAM,CAAE,IAAI,CACZ,MAAM,CAAE,CAAC,CAAC,IAAI,CACd,UAAU,CAAE,MAAM,AACpB,CAAC,AACO,QAAQ,AAAE,CAAC,AACjB,MAAM,CAAE,IAAI,CAAC,UAAU,AACzB,CAAC,AACO,UAAU,AAAE,CAAC,AACnB,aAAa,CAAE,KAAK,CACpB,aAAa,CAAE,IAAI,CACnB,MAAM,CAAE,IAAI,AACd,CAAC,AACO,kDAAkD,AAAE,CAAC,AAC3D,aAAa,CAAE,IAAI,CACnB,UAAU,CAAE,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,GAAG,CAAC,CAC5C,gBAAgB,CAAE,IAAI,AACxB,CAAC,AACO,4CAA4C,AAAE,CAAC,AACrD,KAAK,CAAE,GAAG,CACV,gBAAgB,CAAE,WAAW,CAC7B,UAAU,CAAE,IAAI,AAClB,CAAC,AAED,OAAO,MAAM,CAAC,GAAG,CAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AACpC,gBAAgB,eAAC,CAAC,AAChB,KAAK,CAAE,IAAI,CACX,SAAS,CAAE,KAAK,AAClB,CAAC,AACH,CAAC\"}"
};

const Table = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { rows = [] } = $$props;
	let { onRowSelected } = $$props;
	let { onUnselect } = $$props;
	let { selectedRows = [] } = $$props;
	let gridOptions = {};

	onMount(() => {
		document.addEventListener("DOMContentLoaded", () => {
			gridOptions = {
				columnDefs: columns,
				rowData: rows,
				rowSelection: "multiple",
				rowMultiSelectWithClick: true,
				pagination: true,
				defaultColDef: { filter: true },
				onRowSelected: event => {
					if (onRowSelected && event.node.selected) {
						onRowSelected(gridOptions, event.node.data);
					}
				},
				onSelectionChanged: event => {
					const rowCount = event.api.getSelectedNodes().length;

					if (rowCount == 0) {
						gridOptions.api.setFilterModel(null);

						if (onUnselect) {
							onUnselect();
						}
					}

					selectedRows = event.api.getSelectedNodes();
				}
			};

			const gridDiv = document.querySelector("#table-container");
			new agGrid.Grid(gridDiv, gridOptions);
		});
	});

	if ($$props.rows === void 0 && $$bindings.rows && rows !== void 0) $$bindings.rows(rows);
	if ($$props.onRowSelected === void 0 && $$bindings.onRowSelected && onRowSelected !== void 0) $$bindings.onRowSelected(onRowSelected);
	if ($$props.onUnselect === void 0 && $$bindings.onUnselect && onUnselect !== void 0) $$bindings.onUnselect(onUnselect);
	if ($$props.selectedRows === void 0 && $$bindings.selectedRows && selectedRows !== void 0) $$bindings.selectedRows(selectedRows);
	$$result.css.add(css$2);

	let columns = rows.length > 0
	? Object.entries(rows[0]).map(([key], index) => ({
			field: key,
			headerName: capitalize(key),
			sortable: true,
			checkboxSelection: index == 0
		}))
	: [];

	 {
		{
			if (gridOptions && gridOptions.api) {
				gridOptions.api.setColumnDefs(columns);
				gridOptions.api.setRowData(rows);
			}
		}
	}

	return `<div id="${"table-container"}" class="${"table-container ag-theme-balham svelte-1q8bbpf"}"></div>`;
});

/* src/components/Tooltip.svelte generated by Svelte v3.17.1 */

const css$3 = {
	code: ".tooltip.svelte-10t8z01.svelte-10t8z01{position:relative;display:inline-block}.tooltip.svelte-10t8z01 .text.svelte-10t8z01{visibility:hidden;width:120px;background-color:black;color:#fff;text-align:center;border-radius:6px;padding:5px 0;position:absolute;top:150%;left:-15px;z-index:1}.tooltip.svelte-10t8z01:hover .text.svelte-10t8z01{visibility:visible}",
	map: "{\"version\":3,\"file\":\"Tooltip.svelte\",\"sources\":[\"Tooltip.svelte\"],\"sourcesContent\":[\"<script>\\n  export let text;\\n</script>\\n\\n<style>\\n  .tooltip {\\n    position: relative;\\n    display: inline-block;\\n  }\\n\\n  .tooltip .text {\\n    visibility: hidden;\\n    width: 120px;\\n    background-color: black;\\n    color: #fff;\\n    text-align: center;\\n    border-radius: 6px;\\n    padding: 5px 0;\\n    position: absolute;\\n    top: 150%;\\n    left: -15px;\\n    z-index: 1;\\n  }\\n\\n  .tooltip:hover .text {\\n    visibility: visible;\\n  }\\n</style>\\n\\n<div class=\\\"tooltip\\\">\\n  <slot />\\n  <span class=\\\"text\\\">{text}</span>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAKE,QAAQ,8BAAC,CAAC,AACR,QAAQ,CAAE,QAAQ,CAClB,OAAO,CAAE,YAAY,AACvB,CAAC,AAED,uBAAQ,CAAC,KAAK,eAAC,CAAC,AACd,UAAU,CAAE,MAAM,CAClB,KAAK,CAAE,KAAK,CACZ,gBAAgB,CAAE,KAAK,CACvB,KAAK,CAAE,IAAI,CACX,UAAU,CAAE,MAAM,CAClB,aAAa,CAAE,GAAG,CAClB,OAAO,CAAE,GAAG,CAAC,CAAC,CACd,QAAQ,CAAE,QAAQ,CAClB,GAAG,CAAE,IAAI,CACT,IAAI,CAAE,KAAK,CACX,OAAO,CAAE,CAAC,AACZ,CAAC,AAED,uBAAQ,MAAM,CAAC,KAAK,eAAC,CAAC,AACpB,UAAU,CAAE,OAAO,AACrB,CAAC\"}"
};

const Tooltip = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { text } = $$props;
	if ($$props.text === void 0 && $$bindings.text && text !== void 0) $$bindings.text(text);
	$$result.css.add(css$3);

	return `<div class="${"tooltip svelte-10t8z01"}">
  ${$$slots.default ? $$slots.default({}) : ``}
  <span class="${"text svelte-10t8z01"}">${escape(text)}</span>
</div>`;
});

/* src/components/Button.svelte generated by Svelte v3.17.1 */

const css$4 = {
	code: "button.svelte-235oki{margin:0;color:#333;padding:0.5em;font-size:1.05em;border-radius:3px;border-color:transparent;text-decoration:none;outline:none !important;background:none}button.svelte-235oki:hover{color:#888;cursor:pointer}.outline.svelte-235oki{border-width:1px;border-style:solid;border-color:transparent;transition:box-shadow 200ms ease 0s, background-color 200ms ease 0s;border:1px solid #333;padding:5px 20px;background:white;box-shadow:rgba(107, 107, 107, 0.15) 1px 2px 5px 0px}.outline.svelte-235oki:hover{color:white;background:#333;box-shadow:rgba(107, 107, 107, 0.35) 1px 2px 5px 0px}.disabled.svelte-235oki{cursor:not-allowed !important}",
	map: "{\"version\":3,\"file\":\"Button.svelte\",\"sources\":[\"Button.svelte\"],\"sourcesContent\":[\"<script>\\n  import Tooltip from \\\"components/Tooltip.svelte\\\";\\n  export let onClick = () => {};\\n  export let disabled;\\n  export let tooltip;\\n\\n  export let outline;\\n</script>\\n\\n<style>\\n  button {\\n    margin: 0;\\n    color: #333;\\n    padding: 0.5em;\\n    font-size: 1.05em;\\n    border-radius: 3px;\\n    border-color: transparent;\\n    text-decoration: none;\\n    outline: none !important;\\n    background: none;\\n  }\\n\\n  button:hover {\\n    color: #888;\\n    cursor: pointer;\\n  }\\n\\n  .outline {\\n    border-width: 1px;\\n    border-style: solid;\\n    border-color: transparent;\\n    transition: box-shadow 200ms ease 0s, background-color 200ms ease 0s;\\n    border: 1px solid #333;\\n    padding: 5px 20px;\\n    background: white;\\n    box-shadow: rgba(107, 107, 107, 0.15) 1px 2px 5px 0px;\\n  }\\n\\n  .outline:hover {\\n    color: white;\\n    background: #333;\\n    box-shadow: rgba(107, 107, 107, 0.35) 1px 2px 5px 0px;\\n  }\\n\\n  .disabled {\\n    cursor: not-allowed !important;\\n  }\\n</style>\\n\\n{#if tooltip}\\n  <Tooltip text={tooltip}>\\n    <button\\n      {...$$props}\\n      on:click={onClick}\\n      class:disabled\\n      class:outline\\n      {disabled}>\\n      <slot />\\n    </button>\\n  </Tooltip>\\n{:else}\\n  <button\\n    {...$$props}\\n    on:click={onClick}\\n    class:disabled\\n    class:outline\\n    {disabled}>\\n    <slot />\\n  </button>\\n{/if}\\n\"],\"names\":[],\"mappings\":\"AAUE,MAAM,cAAC,CAAC,AACN,MAAM,CAAE,CAAC,CACT,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,KAAK,CACd,SAAS,CAAE,MAAM,CACjB,aAAa,CAAE,GAAG,CAClB,YAAY,CAAE,WAAW,CACzB,eAAe,CAAE,IAAI,CACrB,OAAO,CAAE,IAAI,CAAC,UAAU,CACxB,UAAU,CAAE,IAAI,AAClB,CAAC,AAED,oBAAM,MAAM,AAAC,CAAC,AACZ,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,OAAO,AACjB,CAAC,AAED,QAAQ,cAAC,CAAC,AACR,YAAY,CAAE,GAAG,CACjB,YAAY,CAAE,KAAK,CACnB,YAAY,CAAE,WAAW,CACzB,UAAU,CAAE,UAAU,CAAC,KAAK,CAAC,IAAI,CAAC,EAAE,CAAC,CAAC,gBAAgB,CAAC,KAAK,CAAC,IAAI,CAAC,EAAE,CACpE,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,CACtB,OAAO,CAAE,GAAG,CAAC,IAAI,CACjB,UAAU,CAAE,KAAK,CACjB,UAAU,CAAE,KAAK,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,IAAI,CAAC,CAAC,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,GAAG,AACvD,CAAC,AAED,sBAAQ,MAAM,AAAC,CAAC,AACd,KAAK,CAAE,KAAK,CACZ,UAAU,CAAE,IAAI,CAChB,UAAU,CAAE,KAAK,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,IAAI,CAAC,CAAC,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,GAAG,AACvD,CAAC,AAED,SAAS,cAAC,CAAC,AACT,MAAM,CAAE,WAAW,CAAC,UAAU,AAChC,CAAC\"}"
};

const Button = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { onClick = () => {
		
	} } = $$props;

	let { disabled } = $$props;
	let { tooltip } = $$props;
	let { outline } = $$props;
	if ($$props.onClick === void 0 && $$bindings.onClick && onClick !== void 0) $$bindings.onClick(onClick);
	if ($$props.disabled === void 0 && $$bindings.disabled && disabled !== void 0) $$bindings.disabled(disabled);
	if ($$props.tooltip === void 0 && $$bindings.tooltip && tooltip !== void 0) $$bindings.tooltip(tooltip);
	if ($$props.outline === void 0 && $$bindings.outline && outline !== void 0) $$bindings.outline(outline);
	$$result.css.add(css$4);

	return `${tooltip
	? `${validate_component(Tooltip, "Tooltip").$$render($$result, { text: tooltip }, {}, {
			default: () => `
    <button${spread([$$props, { disabled: disabled || null }], (disabled ? "disabled" : "") + " " + (outline ? "outline" : "") + " " + "svelte-235oki")}>
      ${$$slots.default ? $$slots.default({}) : ``}
    </button>
  `
		})}`
	: `<button${spread([$$props, { disabled: disabled || null }], (disabled ? "disabled" : "") + " " + (outline ? "outline" : "") + " " + "svelte-235oki")}>
    ${$$slots.default ? $$slots.default({}) : ``}
  </button>`}`;
});

/* src/components/Icons/RightChevron.svelte generated by Svelte v3.17.1 */

const RightChevron = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	return `<svg${spread([
		{ width: "12" },
		{ height: "12" },
		{ viewBox: "0 0 14 14" },
		{ fill: "none" },
		{ xmlns: "http://www.w3.org/2000/svg" },
		$$props
	])}>
  <path fill-rule="${"evenodd"}" clip-rule="${"evenodd"}" d="${"M7.00004 0.333328L5.82226 1.51111L10.4778\n    6.16666H0.333374V7.83333H10.4778L5.82226 12.4889L7.00004 13.6667L13.6667\n    6.99999L7.00004 0.333328Z"}"></path>
</svg>`;
});

/* src/components/Header.svelte generated by Svelte v3.17.1 */

const css$5 = {
	code: ".header.svelte-1ytxfb8{position:relative;margin-top:3%}.buttons.svelte-1ytxfb8{width:100%;top:-25px;right:30px;display:flex;position:absolute;justify-content:space-between;padding-left:3.25%;opacity:1;color:#333}.buttons svg{fill:#333;margin-left:5px;transform:translateX(0px);transition:transform 200ms linear}.buttons div.button:hover svg{transform:translateX(6px);fill:#888}.buttons button.disabled svg{transform:none !important}.icon.reverse svg{transform:rotate(180deg);margin:0;margin-right:5px}.buttons .button.back:hover svg{transform:translateX(-6px) rotate(180deg) !important}@media(max-width: 550px){.header h1{margin-top:10vh}.buttons.svelte-1ytxfb8{top:-8vh;right:0px;width:90vw;margin:auto;padding:0}}",
	map: "{\"version\":3,\"file\":\"Header.svelte\",\"sources\":[\"Header.svelte\"],\"sourcesContent\":[\"<script>\\n  import { fade, fly } from \\\"svelte/transition\\\";\\n  import Title from \\\"components/Typography/Title.svelte\\\";\\n  import Table from \\\"components/Table.svelte\\\";\\n  import RightChevron from \\\"components/Icons/RightChevron.svelte\\\";\\n  import Button from \\\"components/Button.svelte\\\";\\n\\n  export let state = {};\\n  export let title;\\n  export let onNext;\\n  export let onBack;\\n  export let disableNext;\\n  export let showBack = true;\\n  export let showNext = true;\\n  export let nextButtonText = \\\"\\\";\\n  export let nextButtonTooltip = \\\"\\\";\\n\\n  $: next =\\n    onNext ||\\n    (() => {\\n      state.nextStep();\\n    });\\n\\n  $: back =\\n    onBack ||\\n    (() => {\\n      state.previousStep();\\n    });\\n</script>\\n\\n<style>\\n  .header {\\n    position: relative;\\n    margin-top: 3%;\\n  }\\n\\n  .buttons {\\n    width: 100%;\\n    top: -25px;\\n    right: 30px;\\n    display: flex;\\n    position: absolute;\\n    justify-content: space-between;\\n    padding-left: 3.25%;\\n    opacity: 1;\\n    color: #333;\\n  }\\n\\n  :global(.buttons svg) {\\n    fill: #333;\\n    margin-left: 5px;\\n    transform: translateX(0px);\\n    transition: transform 200ms linear;\\n  }\\n\\n  :global(.buttons div.button:hover svg) {\\n    transform: translateX(6px);\\n    fill: #888;\\n  }\\n\\n  :global(.buttons button.disabled svg) {\\n    transform: none !important;\\n  }\\n\\n  :global(.icon.reverse svg) {\\n    transform: rotate(180deg);\\n    margin: 0;\\n    margin-right: 5px;\\n  }\\n\\n  :global(.buttons .button.back:hover svg) {\\n    transform: translateX(-6px) rotate(180deg) !important;\\n  }\\n\\n  @media (max-width: 550px) {\\n    :global(.header h1) {\\n      margin-top: 10vh;\\n    }\\n    .buttons {\\n      top: -8vh;\\n      right: 0px;\\n      width: 90vw;\\n      margin: auto;\\n      padding: 0;\\n    }\\n  }\\n</style>\\n\\n<div class=\\\"header\\\">\\n  <Title>{title}</Title>\\n  <div class=\\\"buttons\\\">\\n    {#if showBack}\\n      <div class=\\\"button back\\\" in:fade out:fade>\\n        <Button onClick={back}>\\n          <span class=\\\"icon reverse\\\">\\n            <RightChevron />\\n          </span>\\n          Back\\n        </Button>\\n      </div>\\n    {/if}\\n    {#if showNext}\\n      <div class=\\\"button\\\" in:fade out:fade>\\n        <Button\\n          onClick={next}\\n          disabled={disableNext}\\n          tooltip={nextButtonTooltip}>\\n          {nextButtonText}\\n          <RightChevron />\\n        </Button>\\n      </div>\\n    {/if}\\n  </div>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AA+BE,OAAO,eAAC,CAAC,AACP,QAAQ,CAAE,QAAQ,CAClB,UAAU,CAAE,EAAE,AAChB,CAAC,AAED,QAAQ,eAAC,CAAC,AACR,KAAK,CAAE,IAAI,CACX,GAAG,CAAE,KAAK,CACV,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,IAAI,CACb,QAAQ,CAAE,QAAQ,CAClB,eAAe,CAAE,aAAa,CAC9B,YAAY,CAAE,KAAK,CACnB,OAAO,CAAE,CAAC,CACV,KAAK,CAAE,IAAI,AACb,CAAC,AAEO,YAAY,AAAE,CAAC,AACrB,IAAI,CAAE,IAAI,CACV,WAAW,CAAE,GAAG,CAChB,SAAS,CAAE,WAAW,GAAG,CAAC,CAC1B,UAAU,CAAE,SAAS,CAAC,KAAK,CAAC,MAAM,AACpC,CAAC,AAEO,6BAA6B,AAAE,CAAC,AACtC,SAAS,CAAE,WAAW,GAAG,CAAC,CAC1B,IAAI,CAAE,IAAI,AACZ,CAAC,AAEO,4BAA4B,AAAE,CAAC,AACrC,SAAS,CAAE,IAAI,CAAC,UAAU,AAC5B,CAAC,AAEO,iBAAiB,AAAE,CAAC,AAC1B,SAAS,CAAE,OAAO,MAAM,CAAC,CACzB,MAAM,CAAE,CAAC,CACT,YAAY,CAAE,GAAG,AACnB,CAAC,AAEO,+BAA+B,AAAE,CAAC,AACxC,SAAS,CAAE,WAAW,IAAI,CAAC,CAAC,OAAO,MAAM,CAAC,CAAC,UAAU,AACvD,CAAC,AAED,MAAM,AAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AACjB,UAAU,AAAE,CAAC,AACnB,UAAU,CAAE,IAAI,AAClB,CAAC,AACD,QAAQ,eAAC,CAAC,AACR,GAAG,CAAE,IAAI,CACT,KAAK,CAAE,GAAG,CACV,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,OAAO,CAAE,CAAC,AACZ,CAAC,AACH,CAAC\"}"
};

const Header = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { state = {} } = $$props;
	let { title } = $$props;
	let { onNext } = $$props;
	let { onBack } = $$props;
	let { disableNext } = $$props;
	let { showBack = true } = $$props;
	let { showNext = true } = $$props;
	let { nextButtonText = "" } = $$props;
	let { nextButtonTooltip = "" } = $$props;
	if ($$props.state === void 0 && $$bindings.state && state !== void 0) $$bindings.state(state);
	if ($$props.title === void 0 && $$bindings.title && title !== void 0) $$bindings.title(title);
	if ($$props.onNext === void 0 && $$bindings.onNext && onNext !== void 0) $$bindings.onNext(onNext);
	if ($$props.onBack === void 0 && $$bindings.onBack && onBack !== void 0) $$bindings.onBack(onBack);
	if ($$props.disableNext === void 0 && $$bindings.disableNext && disableNext !== void 0) $$bindings.disableNext(disableNext);
	if ($$props.showBack === void 0 && $$bindings.showBack && showBack !== void 0) $$bindings.showBack(showBack);
	if ($$props.showNext === void 0 && $$bindings.showNext && showNext !== void 0) $$bindings.showNext(showNext);
	if ($$props.nextButtonText === void 0 && $$bindings.nextButtonText && nextButtonText !== void 0) $$bindings.nextButtonText(nextButtonText);
	if ($$props.nextButtonTooltip === void 0 && $$bindings.nextButtonTooltip && nextButtonTooltip !== void 0) $$bindings.nextButtonTooltip(nextButtonTooltip);
	$$result.css.add(css$5);

	let next = onNext || (() => {
		state.nextStep();
	});

	let back = onBack || (() => {
		state.previousStep();
	});

	return `<div class="${"header svelte-1ytxfb8"}">
  ${validate_component(Title, "Title").$$render($$result, {}, {}, { default: () => `${escape(title)}` })}
  <div class="${"buttons svelte-1ytxfb8"}">
    ${showBack
	? `<div class="${"button back"}">
        ${validate_component(Button, "Button").$$render($$result, { onClick: back }, {}, {
			default: () => `
          <span class="${"icon reverse"}">
            ${validate_component(RightChevron, "RightChevron").$$render($$result, {}, {}, {})}
          </span>
          Back
        `
		})}
      </div>`
	: ``}
    ${showNext
	? `<div class="${"button"}">
        ${validate_component(Button, "Button").$$render(
			$$result,
			{
				onClick: next,
				disabled: disableNext,
				tooltip: nextButtonTooltip
			},
			{},
			{
				default: () => `
          ${escape(nextButtonText)}
          ${validate_component(RightChevron, "RightChevron").$$render($$result, {}, {}, {})}
        `
			}
		)}
      </div>`
	: ``}
  </div>
</div>`;
});

/* src/routes/Promote.svelte generated by Svelte v3.17.1 */

const css$6 = {
	code: ".promote .button{margin-left:auto}#table-container{margin:auto;margin-top:5%}",
	map: "{\"version\":3,\"file\":\"Promote.svelte\",\"sources\":[\"Promote.svelte\"],\"sourcesContent\":[\"<script>\\n  import { onMount } from \\\"svelte\\\";\\n  import { fade, fly } from \\\"svelte/transition\\\";\\n  import Title from \\\"components/Typography/Title.svelte\\\";\\n  import Table from \\\"components/Table.svelte\\\";\\n  import Button from \\\"components/Button.svelte\\\";\\n  import Header from \\\"components/Header.svelte\\\";\\n  import RightChevron from \\\"components/Icons/RightChevron.svelte\\\";\\n\\n  export let state = {};\\n  export let assets = [];\\n\\n  let selectedRows = [];\\n  let showActivate = false;\\n\\n  onMount(() => {\\n    fetch(`/get-assets`, {\\n      method: \\\"get\\\",\\n      headers: {\\n        \\\"Content-Type\\\": \\\"application/json\\\"\\n      }\\n    })\\n      .then(resp => resp.json())\\n      .then(response => {\\n        state.setAssets(response);\\n      });\\n  });\\n\\n  function filterByCorr(gridOptions, { corrKey, name }) {\\n    showActivate = true;\\n    gridOptions.api.setFilterModel({\\n      corrKey: {\\n        type: \\\"contains\\\",\\n        filter: corrKey\\n      }\\n    });\\n  }\\n\\n  function onNext() {\\n    state.setSelectedAssets(selectedRows.map(({ data }) => data));\\n    state.nextStep();\\n  }\\n</script>\\n\\n<style>\\n  :global(.promote .button) {\\n    margin-left: auto;\\n  }\\n  :global(#table-container) {\\n    margin: auto;\\n    margin-top: 5%;\\n  }\\n</style>\\n\\n<div class=\\\"promote\\\">\\n  <Header\\n    title=\\\"Please select assets to promote\\\"\\n    nextButtonText=\\\"Promote\\\"\\n    showBack={false}\\n    showNext={showActivate}\\n    {state}\\n    {onNext} />\\n  <Table\\n    rows={assets}\\n    onRowSelected={filterByCorr}\\n    onUnselect={() => (showActivate = false)}\\n    bind:selectedRows />\\n</div>\\n\"],\"names\":[],\"mappings\":\"AA6CU,gBAAgB,AAAE,CAAC,AACzB,WAAW,CAAE,IAAI,AACnB,CAAC,AACO,gBAAgB,AAAE,CAAC,AACzB,MAAM,CAAE,IAAI,CACZ,UAAU,CAAE,EAAE,AAChB,CAAC\"}"
};

const Promote = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { state = {} } = $$props;
	let { assets = [] } = $$props;
	let selectedRows = [];
	let showActivate = false;

	onMount(() => {
		fetch(`/get-assets`, {
			method: "get",
			headers: { "Content-Type": "application/json" }
		}).then(resp => resp.json()).then(response => {
			state.setAssets(response);
		});
	});

	function filterByCorr(gridOptions, { corrKey, name }) {
		showActivate = true;

		gridOptions.api.setFilterModel({
			corrKey: { type: "contains", filter: corrKey }
		});
	}

	function onNext() {
		state.setSelectedAssets(selectedRows.map(({ data }) => data));
		state.nextStep();
	}

	if ($$props.state === void 0 && $$bindings.state && state !== void 0) $$bindings.state(state);
	if ($$props.assets === void 0 && $$bindings.assets && assets !== void 0) $$bindings.assets(assets);
	$$result.css.add(css$6);
	let $$settled;
	let $$rendered;

	do {
		$$settled = true;

		$$rendered = `<div class="${"promote"}">
  ${validate_component(Header, "Header").$$render(
			$$result,
			{
				title: "Please select assets to promote",
				nextButtonText: "Promote",
				showBack: false,
				showNext: showActivate,
				state,
				onNext
			},
			{},
			{}
		)}
  ${validate_component(Table, "Table").$$render(
			$$result,
			{
				rows: assets,
				onRowSelected: filterByCorr,
				onUnselect: () => showActivate = false,
				selectedRows
			},
			{
				selectedRows: $$value => {
					selectedRows = $$value;
					$$settled = false;
				}
			},
			{}
		)}
</div>`;
	} while (!$$settled);

	return $$rendered;
});

/* node_modules/svelte-select/src/Item.svelte generated by Svelte v3.17.1 */

const css$7 = {
	code: ".item.svelte-1xfc328{cursor:default;height:var(--height, 42px);line-height:var(--height, 42px);padding:var(--itemPadding, 0 20px);text-overflow:ellipsis;overflow:hidden;white-space:nowrap}.groupHeader.svelte-1xfc328{text-transform:var(--groupTitleTextTransform, uppercase)}.groupItem.svelte-1xfc328{padding-left:40px}.item.svelte-1xfc328:active{background:var(--itemActiveBackground, #b9daff)}.item.active.svelte-1xfc328{background:var(--itemIsActiveBG, #007aff);color:var(--itemIsActiveColor, #fff)}.item.first.svelte-1xfc328{border-radius:var(--itemFirstBorderRadius, 4px 4px 0 0)}.item.hover.svelte-1xfc328:not(.active){background:var(--itemHoverBG, #e7f2ff)}",
	map: "{\"version\":3,\"file\":\"Item.svelte\",\"sources\":[\"Item.svelte\"],\"sourcesContent\":[\"<script>\\n  export let isActive = false;\\n  export let isFirst = false;\\n  export let isHover = false;\\n  export let getOptionLabel = undefined;\\n  export let item = undefined;\\n  export let filterText = '';\\n\\n  let itemClasses = '';\\n\\n  $: {\\n    const classes = [];\\n    if (isActive) { classes.push('active'); }\\n    if (isFirst) { classes.push('first'); }\\n    if (isHover) { classes.push('hover'); }\\n    if (item.isGroupHeader) { classes.push('groupHeader'); }\\n    if (item.isGroupItem) { classes.push('groupItem'); }\\n    itemClasses = classes.join(' ');\\n  }\\n</script>\\n\\n<style>\\n  .item {\\n    cursor: default;\\n    height: var(--height, 42px);\\n    line-height: var(--height, 42px);\\n    padding: var(--itemPadding, 0 20px);\\n    text-overflow: ellipsis;\\n    overflow: hidden;\\n    white-space: nowrap;\\n  }\\n\\n  .groupHeader {\\n    text-transform: var(--groupTitleTextTransform, uppercase);\\n  }\\n\\n  .groupItem {\\n    padding-left: 40px;\\n  }\\n\\n  .item:active {\\n    background: var(--itemActiveBackground, #b9daff);\\n  }\\n\\n  .item.active {\\n    background: var(--itemIsActiveBG, #007aff);\\n    color: var(--itemIsActiveColor, #fff);\\n  }\\n\\n  .item.first {\\n    border-radius: var(--itemFirstBorderRadius, 4px 4px 0 0);\\n  }\\n\\n  .item.hover:not(.active) {\\n    background: var(--itemHoverBG, #e7f2ff);\\n  }\\n</style>\\n\\n\\n\\n<div class=\\\"item {itemClasses}\\\">\\n  {@html getOptionLabel(item, filterText)}\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAsBE,KAAK,eAAC,CAAC,AACL,MAAM,CAAE,OAAO,CACf,MAAM,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAC3B,WAAW,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAChC,OAAO,CAAE,IAAI,aAAa,CAAC,OAAO,CAAC,CACnC,aAAa,CAAE,QAAQ,CACvB,QAAQ,CAAE,MAAM,CAChB,WAAW,CAAE,MAAM,AACrB,CAAC,AAED,YAAY,eAAC,CAAC,AACZ,cAAc,CAAE,IAAI,yBAAyB,CAAC,UAAU,CAAC,AAC3D,CAAC,AAED,UAAU,eAAC,CAAC,AACV,YAAY,CAAE,IAAI,AACpB,CAAC,AAED,oBAAK,OAAO,AAAC,CAAC,AACZ,UAAU,CAAE,IAAI,sBAAsB,CAAC,QAAQ,CAAC,AAClD,CAAC,AAED,KAAK,OAAO,eAAC,CAAC,AACZ,UAAU,CAAE,IAAI,gBAAgB,CAAC,QAAQ,CAAC,CAC1C,KAAK,CAAE,IAAI,mBAAmB,CAAC,KAAK,CAAC,AACvC,CAAC,AAED,KAAK,MAAM,eAAC,CAAC,AACX,aAAa,CAAE,IAAI,uBAAuB,CAAC,YAAY,CAAC,AAC1D,CAAC,AAED,KAAK,qBAAM,KAAK,OAAO,CAAC,AAAC,CAAC,AACxB,UAAU,CAAE,IAAI,aAAa,CAAC,QAAQ,CAAC,AACzC,CAAC\"}"
};

const Item = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { isActive = false } = $$props;
	let { isFirst = false } = $$props;
	let { isHover = false } = $$props;
	let { getOptionLabel = undefined } = $$props;
	let { item = undefined } = $$props;
	let { filterText = "" } = $$props;
	let itemClasses = "";
	if ($$props.isActive === void 0 && $$bindings.isActive && isActive !== void 0) $$bindings.isActive(isActive);
	if ($$props.isFirst === void 0 && $$bindings.isFirst && isFirst !== void 0) $$bindings.isFirst(isFirst);
	if ($$props.isHover === void 0 && $$bindings.isHover && isHover !== void 0) $$bindings.isHover(isHover);
	if ($$props.getOptionLabel === void 0 && $$bindings.getOptionLabel && getOptionLabel !== void 0) $$bindings.getOptionLabel(getOptionLabel);
	if ($$props.item === void 0 && $$bindings.item && item !== void 0) $$bindings.item(item);
	if ($$props.filterText === void 0 && $$bindings.filterText && filterText !== void 0) $$bindings.filterText(filterText);
	$$result.css.add(css$7);

	 {
		{
			const classes = [];

			if (isActive) {
				classes.push("active");
			}

			if (isFirst) {
				classes.push("first");
			}

			if (isHover) {
				classes.push("hover");
			}

			if (item.isGroupHeader) {
				classes.push("groupHeader");
			}

			if (item.isGroupItem) {
				classes.push("groupItem");
			}

			itemClasses = classes.join(" ");
		}
	}

	return `<div class="${"item " + escape(itemClasses) + " svelte-1xfc328"}">
  ${getOptionLabel(item, filterText)}
</div>`;
});

/* node_modules/svelte-select/src/VirtualList.svelte generated by Svelte v3.17.1 */

const css$8 = {
	code: "svelte-virtual-list-viewport.svelte-p6ehlv{position:relative;overflow-y:auto;-webkit-overflow-scrolling:touch;display:block}svelte-virtual-list-contents.svelte-p6ehlv,svelte-virtual-list-row.svelte-p6ehlv{display:block}svelte-virtual-list-row.svelte-p6ehlv{overflow:hidden}",
	map: "{\"version\":3,\"file\":\"VirtualList.svelte\",\"sources\":[\"VirtualList.svelte\"],\"sourcesContent\":[\"<script>\\n\\timport { onMount, tick } from 'svelte';\\n\\n\\t// props\\n\\texport let items = undefined;\\n\\texport let height = '100%';\\n\\texport let itemHeight = 40;\\n\\texport let hoverItemIndex = 0;\\n\\n\\t// read-only, but visible to consumers via bind:start\\n\\texport let start = 0;\\n\\texport let end = 0;\\n\\n\\t// local state\\n\\tlet height_map = [];\\n\\tlet rows;\\n\\tlet viewport;\\n\\tlet contents;\\n\\tlet viewport_height = 0;\\n\\tlet visible;\\n\\tlet mounted;\\n\\n\\tlet top = 0;\\n\\tlet bottom = 0;\\n\\tlet average_height;\\n\\n\\t$: visible = items.slice(start, end).map((data, i) => {\\n\\t\\treturn { index: i + start, data };\\n\\t});\\n\\n\\t// whenever `items` changes, invalidate the current heightmap\\n\\t$: if (mounted) refresh(items, viewport_height, itemHeight);\\n\\n\\tasync function refresh(items, viewport_height, itemHeight) {\\n\\t\\tconst { scrollTop } = viewport;\\n\\n\\t\\tawait tick(); // wait until the DOM is up to date\\n\\n\\t\\tlet content_height = top - scrollTop;\\n\\t\\tlet i = start;\\n\\n\\t\\twhile (content_height < viewport_height && i < items.length) {\\n\\t\\t\\tlet row = rows[i - start];\\n\\n\\t\\t\\tif (!row) {\\n\\t\\t\\t\\tend = i + 1;\\n\\t\\t\\t\\tawait tick(); // render the newly visible row\\n\\t\\t\\t\\trow = rows[i - start];\\n\\t\\t\\t}\\n\\n\\t\\t\\tconst row_height = height_map[i] = itemHeight || row.offsetHeight;\\n\\t\\t\\tcontent_height += row_height;\\n\\t\\t\\ti += 1;\\n\\t\\t}\\n\\n\\t\\tend = i;\\n\\n\\t\\tconst remaining = items.length - end;\\n\\t\\taverage_height = (top + content_height) / end;\\n\\n\\t\\tbottom = remaining * average_height;\\n\\t\\theight_map.length = items.length;\\n\\n\\t\\tviewport.scrollTop = 0;\\n\\t}\\n\\n\\tasync function handle_scroll() {\\n\\t\\tconst { scrollTop } = viewport;\\n\\n\\t\\tconst old_start = start;\\n\\n\\t\\tfor (let v = 0; v < rows.length; v += 1) {\\n\\t\\t\\theight_map[start + v] = itemHeight || rows[v].offsetHeight;\\n\\t\\t}\\n\\n\\t\\tlet i = 0;\\n\\t\\tlet y = 0;\\n\\n\\t\\twhile (i < items.length) {\\n\\t\\t\\tconst row_height = height_map[i] || average_height;\\n\\t\\t\\tif (y + row_height > scrollTop) {\\n\\t\\t\\t\\tstart = i;\\n\\t\\t\\t\\ttop = y;\\n\\n\\t\\t\\t\\tbreak;\\n\\t\\t\\t}\\n\\n\\t\\t\\ty += row_height;\\n\\t\\t\\ti += 1;\\n\\t\\t}\\n\\n\\t\\twhile (i < items.length) {\\n\\t\\t\\ty += height_map[i] || average_height;\\n\\t\\t\\ti += 1;\\n\\n\\t\\t\\tif (y > scrollTop + viewport_height) break;\\n\\t\\t}\\n\\n\\t\\tend = i;\\n\\n\\t\\tconst remaining = items.length - end;\\n\\t\\taverage_height = y / end;\\n\\n\\t\\twhile (i < items.length) height_map[i++] = average_height;\\n\\t\\tbottom = remaining * average_height;\\n\\n\\t\\t// prevent jumping if we scrolled up into unknown territory\\n\\t\\tif (start < old_start) {\\n\\t\\t\\tawait tick();\\n\\n\\t\\t\\tlet expected_height = 0;\\n\\t\\t\\tlet actual_height = 0;\\n\\n\\t\\t\\tfor (let i = start; i < old_start; i += 1) {\\n\\t\\t\\t\\tif (rows[i - start]) {\\n\\t\\t\\t\\t\\texpected_height += height_map[i];\\n\\t\\t\\t\\t\\tactual_height += itemHeight || rows[i - start].offsetHeight;\\n\\t\\t\\t\\t}\\n\\t\\t\\t}\\n\\n\\t\\t\\tconst d = actual_height - expected_height;\\n\\t\\t\\tviewport.scrollTo(0, scrollTop + d);\\n\\t\\t}\\n\\n\\t\\t// TODO if we overestimated the space these\\n\\t\\t// rows would occupy we may need to add some\\n\\t\\t// more. maybe we can just call handle_scroll again?\\n\\t}\\n\\n\\t// trigger initial refresh\\n\\tonMount(() => {\\n\\t\\trows = contents.getElementsByTagName('svelte-virtual-list-row');\\n\\t\\tmounted = true;\\n\\t});\\n</script>\\n\\n<style>\\n\\tsvelte-virtual-list-viewport {\\n\\t\\tposition: relative;\\n\\t\\toverflow-y: auto;\\n\\t\\t-webkit-overflow-scrolling: touch;\\n\\t\\tdisplay: block;\\n\\t}\\n\\n\\tsvelte-virtual-list-contents,\\n\\tsvelte-virtual-list-row {\\n\\t\\tdisplay: block;\\n\\t}\\n\\n\\tsvelte-virtual-list-row {\\n\\t\\toverflow: hidden;\\n\\t}\\n</style>\\n\\n<svelte-virtual-list-viewport bind:this={viewport} bind:offsetHeight={viewport_height} on:scroll={handle_scroll}\\n\\tstyle=\\\"height: {height};\\\">\\n\\t<svelte-virtual-list-contents bind:this={contents} style=\\\"padding-top: {top}px; padding-bottom: {bottom}px;\\\">\\n\\t\\t{#each visible as row (row.index)}\\n\\t\\t\\t<svelte-virtual-list-row>\\n\\t\\t\\t\\t<slot item={row.data} i={row.index} {hoverItemIndex}>Missing template</slot>\\n\\t\\t\\t</svelte-virtual-list-row>\\n\\t\\t{/each}\\n\\t</svelte-virtual-list-contents>\\n</svelte-virtual-list-viewport>\"],\"names\":[],\"mappings\":\"AAyIC,4BAA4B,cAAC,CAAC,AAC7B,QAAQ,CAAE,QAAQ,CAClB,UAAU,CAAE,IAAI,CAChB,0BAA0B,CAAE,KAAK,CACjC,OAAO,CAAE,KAAK,AACf,CAAC,AAED,0CAA4B,CAC5B,uBAAuB,cAAC,CAAC,AACxB,OAAO,CAAE,KAAK,AACf,CAAC,AAED,uBAAuB,cAAC,CAAC,AACxB,QAAQ,CAAE,MAAM,AACjB,CAAC\"}"
};

const VirtualList = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { items = undefined } = $$props;
	let { height = "100%" } = $$props;
	let { itemHeight = 40 } = $$props;
	let { hoverItemIndex = 0 } = $$props;
	let { start = 0 } = $$props;
	let { end = 0 } = $$props;
	let height_map = [];
	let rows;
	let viewport;
	let contents;
	let viewport_height = 0;
	let visible;
	let mounted;
	let top = 0;
	let bottom = 0;
	let average_height;

	async function refresh(items, viewport_height, itemHeight) {
		const { scrollTop } = viewport;
		await tick();
		let content_height = top - scrollTop;
		let i = start;

		while (content_height < viewport_height && i < items.length) {
			let row = rows[i - start];

			if (!row) {
				end = i + 1;
				await tick();
				row = rows[i - start];
			}

			const row_height = height_map[i] = itemHeight || row.offsetHeight;
			content_height += row_height;
			i += 1;
		}

		end = i;
		const remaining = items.length - end;
		average_height = (top + content_height) / end;
		bottom = remaining * average_height;
		height_map.length = items.length;
		viewport.scrollTop = 0;
	}

	onMount(() => {
		rows = contents.getElementsByTagName("svelte-virtual-list-row");
		mounted = true;
	});

	if ($$props.items === void 0 && $$bindings.items && items !== void 0) $$bindings.items(items);
	if ($$props.height === void 0 && $$bindings.height && height !== void 0) $$bindings.height(height);
	if ($$props.itemHeight === void 0 && $$bindings.itemHeight && itemHeight !== void 0) $$bindings.itemHeight(itemHeight);
	if ($$props.hoverItemIndex === void 0 && $$bindings.hoverItemIndex && hoverItemIndex !== void 0) $$bindings.hoverItemIndex(hoverItemIndex);
	if ($$props.start === void 0 && $$bindings.start && start !== void 0) $$bindings.start(start);
	if ($$props.end === void 0 && $$bindings.end && end !== void 0) $$bindings.end(end);
	$$result.css.add(css$8);

	visible = items.slice(start, end).map((data, i) => {
		return { index: i + start, data };
	});

	 {
		if (mounted) refresh(items, viewport_height, itemHeight);
	}

	return `<svelte-virtual-list-viewport style="${"height: " + escape(height) + ";"}" class="${"svelte-p6ehlv"}"${add_attribute("this", viewport, 1)}>
	<svelte-virtual-list-contents style="${"padding-top: " + escape(top) + "px; padding-bottom: " + escape(bottom) + "px;"}" class="${"svelte-p6ehlv"}"${add_attribute("this", contents, 1)}>
		${each(visible, row => `<svelte-virtual-list-row class="${"svelte-p6ehlv"}">
				${$$slots.default
	? $$slots.default({
			item: row.data,
			i: row.index,
			hoverItemIndex
		})
	: `Missing template`}
			</svelte-virtual-list-row>`)}
	</svelte-virtual-list-contents>
</svelte-virtual-list-viewport>`;
});

/* node_modules/svelte-select/src/List.svelte generated by Svelte v3.17.1 */

const css$9 = {
	code: ".listContainer.svelte-bqv8jo{box-shadow:var(--listShadow, 0 2px 3px 0 rgba(44, 62, 80, 0.24));border-radius:var(--listBorderRadius, 4px);max-height:var(--listMaxHeight, 250px);overflow-y:auto;background:var(--listBackground, #fff)}.virtualList.svelte-bqv8jo{height:var(--virtualListHeight, 200px)}.listGroupTitle.svelte-bqv8jo{color:var(--groupTitleColor, #8f8f8f);cursor:default;font-size:var(--groupTitleFontSize, 12px);height:var(--height, 42px);line-height:var(--height, 42px);padding:var(--groupTitlePadding, 0 20px);text-overflow:ellipsis;overflow-x:hidden;white-space:nowrap;text-transform:var(--groupTitleTextTransform, uppercase)}.empty.svelte-bqv8jo{text-align:var(--listEmptyTextAlign, center);padding:var(--listEmptyPadding, 20px 0);color:var(--listEmptyColor, #78848F)}",
	map: "{\"version\":3,\"file\":\"List.svelte\",\"sources\":[\"List.svelte\"],\"sourcesContent\":[\"<script>\\n  import { beforeUpdate, createEventDispatcher, onDestroy, onMount, tick } from 'svelte';\\n\\n  const dispatch = createEventDispatcher();\\n\\n  export let container = undefined;\\n\\n  import ItemComponent from './Item.svelte';\\n  import VirtualList from './VirtualList.svelte';\\n\\n  export let Item = ItemComponent;\\n  export let isVirtualList = false;\\n  export let items = [];\\n  export let getOptionLabel = (option, filterText) => {\\n    if (option) return option.isCreator ? `Create \\\\\\\"${filterText}\\\\\\\"` : option.label;\\n  };\\n  export let getGroupHeaderLabel = (option) => { return option.label };\\n  export let itemHeight = 40;\\n  export let hoverItemIndex = 0;\\n  export let selectedValue = undefined;\\n  export let optionIdentifier = 'value';\\n  export let hideEmptyState = false;\\n  export let noOptionsMessage = 'No options';\\n  export let isMulti = false;\\n  export let activeItemIndex = 0;\\n  export let filterText = '';\\n\\n  let isScrollingTimer = 0;\\n  let isScrolling = false;\\n  let prev_items;\\n  let prev_activeItemIndex;\\n  let prev_selectedValue;\\n\\n  onMount(() => {\\n    if (items.length > 0 && !isMulti && selectedValue) {\\n      const _hoverItemIndex = items.findIndex((item) => item[optionIdentifier] === selectedValue[optionIdentifier]);\\n\\n      if (_hoverItemIndex) {\\n        hoverItemIndex = _hoverItemIndex;\\n      }\\n    }\\n\\n    scrollToActiveItem('active');\\n\\n\\n    container.addEventListener('scroll', () => {\\n      clearTimeout(isScrollingTimer);\\n\\n      isScrollingTimer = setTimeout(() => {\\n        isScrolling = false;\\n      }, 100);\\n    }, false);\\n  });\\n\\n  onDestroy(() => {\\n    // clearTimeout(isScrollingTimer);\\n  });\\n\\n  beforeUpdate(() => {\\n\\n    if (items !== prev_items && items.length > 0) {\\n      hoverItemIndex = 0;\\n    }\\n\\n\\n    // if (prev_activeItemIndex && activeItemIndex > -1) {\\n    //   hoverItemIndex = activeItemIndex;\\n\\n    //   scrollToActiveItem('active');\\n    // }\\n    // if (prev_selectedValue && selectedValue) {\\n    //   scrollToActiveItem('active');\\n\\n    //   if (items && !isMulti) {\\n    //     const hoverItemIndex = items.findIndex((item) => item[optionIdentifier] === selectedValue[optionIdentifier]);\\n\\n    //     if (hoverItemIndex) {\\n    //       hoverItemIndex = hoverItemIndex;\\n    //     }\\n    //   }\\n    // }\\n\\n    prev_items = items;\\n    prev_activeItemIndex = activeItemIndex;\\n    prev_selectedValue = selectedValue;\\n  });\\n\\n  function itemClasses(hoverItemIndex, item, itemIndex, items, selectedValue, optionIdentifier, isMulti) {\\n    return `${selectedValue && !isMulti && (selectedValue[optionIdentifier] === item[optionIdentifier]) ? 'active ' : ''}${hoverItemIndex === itemIndex || items.length === 1 ? 'hover' : ''}`;\\n  }\\n\\n  function handleSelect(item) {\\n    if (item.isCreator) return;\\n    dispatch('itemSelected', item);\\n  }\\n\\n  function handleHover(i) {\\n    if (isScrolling) return;\\n    hoverItemIndex = i;\\n  }\\n\\n  function handleClick(args) {\\n    const { item, i, event } = args;\\n    event.stopPropagation();\\n\\n    if (selectedValue && !isMulti && selectedValue[optionIdentifier] === item[optionIdentifier]) return closeList();\\n\\n    if (item.isCreator) {\\n      dispatch('itemCreated', filterText);\\n    } else {\\n      activeItemIndex = i;\\n      hoverItemIndex = i;\\n      handleSelect(item);\\n    }\\n  }\\n\\n  function closeList() {\\n    dispatch('closeList');\\n  }\\n\\n  async function updateHoverItem(increment) {\\n    if (isVirtualList) return;\\n\\n    let isNonSelectableItem = true;\\n\\n    while (isNonSelectableItem) {\\n      if (increment > 0 && hoverItemIndex === (items.length - 1)) {\\n        hoverItemIndex = 0;\\n      }\\n      else if (increment < 0 && hoverItemIndex === 0) {\\n        hoverItemIndex = items.length - 1;\\n      }\\n      else {\\n        hoverItemIndex = hoverItemIndex + increment;\\n      }\\n\\n      isNonSelectableItem = items[hoverItemIndex].isGroupHeader && !items[hoverItemIndex].isSelectable;\\n    }\\n\\n    await tick();\\n\\n    scrollToActiveItem('hover');\\n  }\\n\\n  function handleKeyDown(e) {\\n    switch (e.key) {\\n      case 'ArrowDown':\\n        e.preventDefault();\\n        items.length && updateHoverItem(1);\\n        break;\\n      case 'ArrowUp':\\n        e.preventDefault();\\n        items.length && updateHoverItem(-1);\\n        break;\\n      case 'Enter':\\n        e.preventDefault();\\n        if (items.length === 0) break;\\n        const hoverItem = items[hoverItemIndex];\\n        if (selectedValue && !isMulti && selectedValue[optionIdentifier] === hoverItem[optionIdentifier]) {\\n          closeList();\\n          break;\\n        }\\n\\n        if (hoverItem.isCreator) {\\n          dispatch('itemCreated', filterText);\\n        } else {\\n          activeItemIndex = hoverItemIndex;\\n          handleSelect(items[hoverItemIndex]);\\n        }\\n        break;\\n      case 'Tab':\\n        e.preventDefault();\\n        if (items.length === 0) break;\\n        if (selectedValue && selectedValue[optionIdentifier] === items[hoverItemIndex][optionIdentifier]) return closeList();\\n        activeItemIndex = hoverItemIndex;\\n        handleSelect(items[hoverItemIndex]);\\n        break;\\n    }\\n  }\\n\\n  function scrollToActiveItem(className) {\\n    if (isVirtualList || !container) return;\\n\\n    let offsetBounding;\\n    const focusedElemBounding = container.querySelector(`.listItem .${className}`);\\n\\n    if (focusedElemBounding) {\\n      offsetBounding = container.getBoundingClientRect().bottom - focusedElemBounding.getBoundingClientRect().bottom;\\n    }\\n\\n    container.scrollTop -= offsetBounding;\\n  }\\n\\n  function isItemActive(item, selectedValue, optionIdentifier) {\\n    return selectedValue && (selectedValue[optionIdentifier] === item[optionIdentifier]);\\n  };\\n\\n  function isItemFirst(itemIndex) {\\n    return itemIndex === 0;\\n  };\\n\\n  function isItemHover(hoverItemIndex, item, itemIndex, items) {\\n    return hoverItemIndex === itemIndex || items.length === 1;\\n  }\\n\\n</script>\\n\\n<svelte:window on:keydown=\\\"{handleKeyDown}\\\" />\\n\\n{#if isVirtualList}\\n<div class=\\\"listContainer virtualList\\\" bind:this={container}>\\n\\n  <VirtualList {items} {itemHeight} let:item let:i>\\n  \\n    <div on:mouseover=\\\"{() => handleHover(i)}\\\" on:click=\\\"{event => handleClick({item, i, event})}\\\"\\n        class=\\\"listItem\\\">\\n          <svelte:component \\n            this=\\\"{Item}\\\"\\n            {item}\\n            {filterText}\\n            {getOptionLabel}\\n            isFirst=\\\"{isItemFirst(i)}\\\"\\n            isActive=\\\"{isItemActive(item, selectedValue, optionIdentifier)}\\\"\\n            isHover=\\\"{isItemHover(hoverItemIndex, item, i, items)}\\\"\\n          />\\n    </div>\\n  \\n</VirtualList>\\n</div>\\n{/if}\\n\\n{#if !isVirtualList}\\n<div class=\\\"listContainer\\\" bind:this={container}>\\n  {#each items as item, i}\\n    {#if item.isGroupHeader && !item.isSelectable}\\n      <div class=\\\"listGroupTitle\\\">{getGroupHeaderLabel(item)}</div>\\n    { :else }\\n    <div \\n      on:mouseover=\\\"{() => handleHover(i)}\\\" \\n      on:click=\\\"{event => handleClick({item, i, event})}\\\"\\n      class=\\\"listItem\\\"\\n    >\\n      <svelte:component \\n        this=\\\"{Item}\\\"\\n        {item}\\n        {filterText}\\n        {getOptionLabel}\\n        isFirst=\\\"{isItemFirst(i)}\\\"\\n        isActive=\\\"{isItemActive(item, selectedValue, optionIdentifier)}\\\"\\n        isHover=\\\"{isItemHover(hoverItemIndex, item, i, items)}\\\"\\n      />\\n    </div>\\n    {/if}\\n  {:else}\\n    {#if !hideEmptyState}\\n      <div class=\\\"empty\\\">{noOptionsMessage}</div>\\n    {/if}\\n  {/each}\\n</div>\\n{/if}\\n\\n<style>\\n  .listContainer {\\n    box-shadow: var(--listShadow, 0 2px 3px 0 rgba(44, 62, 80, 0.24));\\n    border-radius: var(--listBorderRadius, 4px);\\n    max-height: var(--listMaxHeight, 250px);\\n    overflow-y: auto;\\n    background: var(--listBackground, #fff);\\n  }\\n\\n  .virtualList {\\n    height: var(--virtualListHeight, 200px);\\n  }\\n\\n  .listGroupTitle {\\n    color: var(--groupTitleColor, #8f8f8f);\\n    cursor: default;\\n    font-size: var(--groupTitleFontSize, 12px);\\n    height: var(--height, 42px);\\n    line-height: var(--height, 42px);\\n    padding: var(--groupTitlePadding, 0 20px);\\n    text-overflow: ellipsis;\\n    overflow-x: hidden;\\n    white-space: nowrap;\\n    text-transform: var(--groupTitleTextTransform, uppercase);\\n  }\\n\\n  .empty {\\n    text-align: var(--listEmptyTextAlign, center);\\n    padding: var(--listEmptyPadding, 20px 0);\\n    color: var(--listEmptyColor, #78848F);\\n  }\\n</style>\\n\"],\"names\":[],\"mappings\":\"AAsQE,cAAc,cAAC,CAAC,AACd,UAAU,CAAE,IAAI,YAAY,CAAC,mCAAmC,CAAC,CACjE,aAAa,CAAE,IAAI,kBAAkB,CAAC,IAAI,CAAC,CAC3C,UAAU,CAAE,IAAI,eAAe,CAAC,MAAM,CAAC,CACvC,UAAU,CAAE,IAAI,CAChB,UAAU,CAAE,IAAI,gBAAgB,CAAC,KAAK,CAAC,AACzC,CAAC,AAED,YAAY,cAAC,CAAC,AACZ,MAAM,CAAE,IAAI,mBAAmB,CAAC,MAAM,CAAC,AACzC,CAAC,AAED,eAAe,cAAC,CAAC,AACf,KAAK,CAAE,IAAI,iBAAiB,CAAC,QAAQ,CAAC,CACtC,MAAM,CAAE,OAAO,CACf,SAAS,CAAE,IAAI,oBAAoB,CAAC,KAAK,CAAC,CAC1C,MAAM,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAC3B,WAAW,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAChC,OAAO,CAAE,IAAI,mBAAmB,CAAC,OAAO,CAAC,CACzC,aAAa,CAAE,QAAQ,CACvB,UAAU,CAAE,MAAM,CAClB,WAAW,CAAE,MAAM,CACnB,cAAc,CAAE,IAAI,yBAAyB,CAAC,UAAU,CAAC,AAC3D,CAAC,AAED,MAAM,cAAC,CAAC,AACN,UAAU,CAAE,IAAI,oBAAoB,CAAC,OAAO,CAAC,CAC7C,OAAO,CAAE,IAAI,kBAAkB,CAAC,OAAO,CAAC,CACxC,KAAK,CAAE,IAAI,gBAAgB,CAAC,QAAQ,CAAC,AACvC,CAAC\"}"
};

function isItemActive(item, selectedValue, optionIdentifier) {
	return selectedValue && selectedValue[optionIdentifier] === item[optionIdentifier];
}

function isItemFirst(itemIndex) {
	return itemIndex === 0;
}

function isItemHover(hoverItemIndex, item, itemIndex, items) {
	return hoverItemIndex === itemIndex || items.length === 1;
}

const List = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	const dispatch = createEventDispatcher();
	let { container = undefined } = $$props;
	let { Item: Item$1 = Item } = $$props;
	let { isVirtualList = false } = $$props;
	let { items = [] } = $$props;

	let { getOptionLabel = (option, filterText) => {
		if (option) return option.isCreator
		? `Create \"${filterText}\"`
		: option.label;
	} } = $$props;

	let { getGroupHeaderLabel = option => {
		return option.label;
	} } = $$props;

	let { itemHeight = 40 } = $$props;
	let { hoverItemIndex = 0 } = $$props;
	let { selectedValue = undefined } = $$props;
	let { optionIdentifier = "value" } = $$props;
	let { hideEmptyState = false } = $$props;
	let { noOptionsMessage = "No options" } = $$props;
	let { isMulti = false } = $$props;
	let { activeItemIndex = 0 } = $$props;
	let { filterText = "" } = $$props;
	let isScrollingTimer = 0;
	let prev_items;

	onMount(() => {
		if (items.length > 0 && !isMulti && selectedValue) {
			const _hoverItemIndex = items.findIndex(item => item[optionIdentifier] === selectedValue[optionIdentifier]);

			if (_hoverItemIndex) {
				hoverItemIndex = _hoverItemIndex;
			}
		}

		scrollToActiveItem("active");

		container.addEventListener(
			"scroll",
			() => {
				clearTimeout(isScrollingTimer);

				isScrollingTimer = setTimeout(
					() => {
					},
					100
				);
			},
			false
		);
	});

	onDestroy(() => {
		
	});

	beforeUpdate(() => {
		if (items !== prev_items && items.length > 0) {
			hoverItemIndex = 0;
		}

		prev_items = items;
	});

	function scrollToActiveItem(className) {
		if (isVirtualList || !container) return;
		let offsetBounding;
		const focusedElemBounding = container.querySelector(`.listItem .${className}`);

		if (focusedElemBounding) {
			offsetBounding = container.getBoundingClientRect().bottom - focusedElemBounding.getBoundingClientRect().bottom;
		}

		container.scrollTop -= offsetBounding;
	}

	
	
	if ($$props.container === void 0 && $$bindings.container && container !== void 0) $$bindings.container(container);
	if ($$props.Item === void 0 && $$bindings.Item && Item$1 !== void 0) $$bindings.Item(Item$1);
	if ($$props.isVirtualList === void 0 && $$bindings.isVirtualList && isVirtualList !== void 0) $$bindings.isVirtualList(isVirtualList);
	if ($$props.items === void 0 && $$bindings.items && items !== void 0) $$bindings.items(items);
	if ($$props.getOptionLabel === void 0 && $$bindings.getOptionLabel && getOptionLabel !== void 0) $$bindings.getOptionLabel(getOptionLabel);
	if ($$props.getGroupHeaderLabel === void 0 && $$bindings.getGroupHeaderLabel && getGroupHeaderLabel !== void 0) $$bindings.getGroupHeaderLabel(getGroupHeaderLabel);
	if ($$props.itemHeight === void 0 && $$bindings.itemHeight && itemHeight !== void 0) $$bindings.itemHeight(itemHeight);
	if ($$props.hoverItemIndex === void 0 && $$bindings.hoverItemIndex && hoverItemIndex !== void 0) $$bindings.hoverItemIndex(hoverItemIndex);
	if ($$props.selectedValue === void 0 && $$bindings.selectedValue && selectedValue !== void 0) $$bindings.selectedValue(selectedValue);
	if ($$props.optionIdentifier === void 0 && $$bindings.optionIdentifier && optionIdentifier !== void 0) $$bindings.optionIdentifier(optionIdentifier);
	if ($$props.hideEmptyState === void 0 && $$bindings.hideEmptyState && hideEmptyState !== void 0) $$bindings.hideEmptyState(hideEmptyState);
	if ($$props.noOptionsMessage === void 0 && $$bindings.noOptionsMessage && noOptionsMessage !== void 0) $$bindings.noOptionsMessage(noOptionsMessage);
	if ($$props.isMulti === void 0 && $$bindings.isMulti && isMulti !== void 0) $$bindings.isMulti(isMulti);
	if ($$props.activeItemIndex === void 0 && $$bindings.activeItemIndex && activeItemIndex !== void 0) $$bindings.activeItemIndex(activeItemIndex);
	if ($$props.filterText === void 0 && $$bindings.filterText && filterText !== void 0) $$bindings.filterText(filterText);
	$$result.css.add(css$9);

	return `

${isVirtualList
	? `<div class="${"listContainer virtualList svelte-bqv8jo"}"${add_attribute("this", container, 1)}>

  ${validate_component(VirtualList, "VirtualList").$$render($$result, { items, itemHeight }, {}, {
			default: ({ item, i }) => `
  
    <div class="${"listItem"}">
          ${validate_component(Item$1 || missing_component, "svelte:component").$$render(
				$$result,
				{
					item,
					filterText,
					getOptionLabel,
					isFirst: isItemFirst(i),
					isActive: isItemActive(item, selectedValue, optionIdentifier),
					isHover: isItemHover(hoverItemIndex, item, i, items)
				},
				{},
				{}
			)}
    </div>
  
`
		})}
</div>`
	: ``}

${!isVirtualList
	? `<div class="${"listContainer svelte-bqv8jo"}"${add_attribute("this", container, 1)}>
  ${items.length
		? each(items, (item, i) => `${item.isGroupHeader && !item.isSelectable
			? `<div class="${"listGroupTitle svelte-bqv8jo"}">${escape(getGroupHeaderLabel(item))}</div>`
			: `<div class="${"listItem"}">
      ${validate_component(Item$1 || missing_component, "svelte:component").$$render(
					$$result,
					{
						item,
						filterText,
						getOptionLabel,
						isFirst: isItemFirst(i),
						isActive: isItemActive(item, selectedValue, optionIdentifier),
						isHover: isItemHover(hoverItemIndex, item, i, items)
					},
					{},
					{}
				)}
    </div>`}`)
		: `${!hideEmptyState
			? `<div class="${"empty svelte-bqv8jo"}">${escape(noOptionsMessage)}</div>`
			: ``}`}
</div>`
	: ``}`;
});

/* node_modules/svelte-select/src/Selection.svelte generated by Svelte v3.17.1 */

const css$a = {
	code: ".selection.svelte-ch6bh7{text-overflow:ellipsis;overflow-x:hidden;white-space:nowrap}",
	map: "{\"version\":3,\"file\":\"Selection.svelte\",\"sources\":[\"Selection.svelte\"],\"sourcesContent\":[\"<script>\\n  export let getSelectionLabel = undefined;\\n  export let item = undefined;\\n</script>\\n\\n<style>\\n  .selection {\\n    text-overflow: ellipsis;\\n    overflow-x: hidden;\\n    white-space: nowrap;\\n  }\\n</style>\\n\\n<div class=\\\"selection\\\">\\n  {@html getSelectionLabel(item)} \\n</div>\\n\"],\"names\":[],\"mappings\":\"AAME,UAAU,cAAC,CAAC,AACV,aAAa,CAAE,QAAQ,CACvB,UAAU,CAAE,MAAM,CAClB,WAAW,CAAE,MAAM,AACrB,CAAC\"}"
};

const Selection = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { getSelectionLabel = undefined } = $$props;
	let { item = undefined } = $$props;
	if ($$props.getSelectionLabel === void 0 && $$bindings.getSelectionLabel && getSelectionLabel !== void 0) $$bindings.getSelectionLabel(getSelectionLabel);
	if ($$props.item === void 0 && $$bindings.item && item !== void 0) $$bindings.item(item);
	$$result.css.add(css$a);

	return `<div class="${"selection svelte-ch6bh7"}">
  ${getSelectionLabel(item)} 
</div>`;
});

/* node_modules/svelte-select/src/MultiSelection.svelte generated by Svelte v3.17.1 */

const css$b = {
	code: ".multiSelectItem.svelte-rtzfov.svelte-rtzfov{background:var(--multiItemBG, #EBEDEF);margin:var(--multiItemMargin, 5px 5px 0 0);border-radius:var(--multiItemBorderRadius, 16px);height:var(--multiItemHeight, 32px);line-height:var(--multiItemHeight, 32px);display:flex;cursor:default;padding:var(--multiItemPadding, 0 10px 0 15px)}.multiSelectItem_label.svelte-rtzfov.svelte-rtzfov{margin:var(--multiLabelMargin, 0 5px 0 0)}.multiSelectItem.svelte-rtzfov.svelte-rtzfov:hover,.multiSelectItem.active.svelte-rtzfov.svelte-rtzfov{background-color:var(--multiItemActiveBG, #006FFF);color:var(--multiItemActiveColor, #fff)}.multiSelectItem.disabled.svelte-rtzfov.svelte-rtzfov:hover{background:var(--multiItemDisabledHoverBg, #EBEDEF);color:var(--multiItemDisabledHoverColor, #C1C6CC)}.multiSelectItem_clear.svelte-rtzfov.svelte-rtzfov{border-radius:var(--multiClearRadius, 50%);background:var(--multiClearBG, #52616F);width:var(--multiClearWidth, 16px);height:var(--multiClearHeight, 16px);position:relative;top:var(--multiClearTop, 8px);text-align:var(--multiClearTextAlign, center);padding:var(--multiClearPadding, 1px)}.multiSelectItem_clear.svelte-rtzfov.svelte-rtzfov:hover,.active.svelte-rtzfov .multiSelectItem_clear.svelte-rtzfov{background:var(--multiClearHoverBG, #fff)}.multiSelectItem_clear.svelte-rtzfov:hover svg.svelte-rtzfov,.active.svelte-rtzfov .multiSelectItem_clear svg.svelte-rtzfov{fill:var(--multiClearHoverFill, #006FFF)}.multiSelectItem_clear.svelte-rtzfov svg.svelte-rtzfov{fill:var(--multiClearFill, #EBEDEF);vertical-align:top}",
	map: "{\"version\":3,\"file\":\"MultiSelection.svelte\",\"sources\":[\"MultiSelection.svelte\"],\"sourcesContent\":[\"<script>\\n  import { createEventDispatcher } from 'svelte';\\n\\n  const dispatch = createEventDispatcher();\\n\\n  export let selectedValue = [];\\n  export let activeSelectedValue = undefined;\\n  export let isDisabled = false;\\n  export let getSelectionLabel = undefined;\\n\\n  function handleClear(i, event) {\\n    event.stopPropagation();\\n    dispatch('multiItemClear', {i});\\n  }\\n</script>\\n\\n{#each selectedValue as value, i}\\n<div class=\\\"multiSelectItem {activeSelectedValue === i ? 'active' : ''} {isDisabled ? 'disabled' : ''}\\\">\\n  <div class=\\\"multiSelectItem_label\\\">\\n    {@html getSelectionLabel(value)}\\n  </div>\\n  {#if !isDisabled}\\n  <div class=\\\"multiSelectItem_clear\\\" on:click=\\\"{event => handleClear(i, event)}\\\">\\n    <svg width=\\\"100%\\\" height=\\\"100%\\\" viewBox=\\\"-2 -2 50 50\\\" focusable=\\\"false\\\" role=\\\"presentation\\\">\\n      <path\\n        d=\\\"M34.923,37.251L24,26.328L13.077,37.251L9.436,33.61l10.923-10.923L9.436,11.765l3.641-3.641L24,19.047L34.923,8.124 l3.641,3.641L27.641,22.688L38.564,33.61L34.923,37.251z\\\"></path>\\n    </svg>\\n  </div>\\n  {/if}\\n</div>\\n{/each}\\n\\n\\n\\n<style>\\n  .multiSelectItem {\\n    background: var(--multiItemBG, #EBEDEF);\\n    margin: var(--multiItemMargin, 5px 5px 0 0);\\n    border-radius: var(--multiItemBorderRadius, 16px);\\n    height: var(--multiItemHeight, 32px);\\n    line-height: var(--multiItemHeight, 32px);\\n    display: flex;\\n    cursor: default;\\n    padding: var(--multiItemPadding, 0 10px 0 15px);\\n  }\\n\\n  .multiSelectItem_label {\\n    margin: var(--multiLabelMargin, 0 5px 0 0);\\n  }\\n\\n  .multiSelectItem:hover,\\n  .multiSelectItem.active {\\n    background-color: var(--multiItemActiveBG, #006FFF);\\n    color: var(--multiItemActiveColor, #fff);\\n  }\\n\\n  .multiSelectItem.disabled:hover {\\n    background: var(--multiItemDisabledHoverBg, #EBEDEF);\\n    color: var(--multiItemDisabledHoverColor, #C1C6CC);\\n  }\\n\\n  .multiSelectItem_clear {\\n    border-radius: var(--multiClearRadius, 50%);\\n    background: var(--multiClearBG, #52616F);\\n    width: var(--multiClearWidth, 16px);\\n    height: var(--multiClearHeight, 16px);\\n    position: relative;\\n    top: var(--multiClearTop, 8px);\\n    text-align: var(--multiClearTextAlign, center);\\n    padding: var(--multiClearPadding, 1px);\\n  }\\n\\n  .multiSelectItem_clear:hover,\\n  .active .multiSelectItem_clear {\\n    background: var(--multiClearHoverBG, #fff);\\n  }\\n\\n  .multiSelectItem_clear:hover svg,\\n  .active .multiSelectItem_clear svg {\\n    fill: var(--multiClearHoverFill, #006FFF);\\n  }\\n\\n  .multiSelectItem_clear svg {\\n    fill: var(--multiClearFill, #EBEDEF);\\n    vertical-align: top;\\n  }\\n</style>\\n\"],\"names\":[],\"mappings\":\"AAmCE,gBAAgB,4BAAC,CAAC,AAChB,UAAU,CAAE,IAAI,aAAa,CAAC,QAAQ,CAAC,CACvC,MAAM,CAAE,IAAI,iBAAiB,CAAC,YAAY,CAAC,CAC3C,aAAa,CAAE,IAAI,uBAAuB,CAAC,KAAK,CAAC,CACjD,MAAM,CAAE,IAAI,iBAAiB,CAAC,KAAK,CAAC,CACpC,WAAW,CAAE,IAAI,iBAAiB,CAAC,KAAK,CAAC,CACzC,OAAO,CAAE,IAAI,CACb,MAAM,CAAE,OAAO,CACf,OAAO,CAAE,IAAI,kBAAkB,CAAC,cAAc,CAAC,AACjD,CAAC,AAED,sBAAsB,4BAAC,CAAC,AACtB,MAAM,CAAE,IAAI,kBAAkB,CAAC,UAAU,CAAC,AAC5C,CAAC,AAED,4CAAgB,MAAM,CACtB,gBAAgB,OAAO,4BAAC,CAAC,AACvB,gBAAgB,CAAE,IAAI,mBAAmB,CAAC,QAAQ,CAAC,CACnD,KAAK,CAAE,IAAI,sBAAsB,CAAC,KAAK,CAAC,AAC1C,CAAC,AAED,gBAAgB,qCAAS,MAAM,AAAC,CAAC,AAC/B,UAAU,CAAE,IAAI,0BAA0B,CAAC,QAAQ,CAAC,CACpD,KAAK,CAAE,IAAI,6BAA6B,CAAC,QAAQ,CAAC,AACpD,CAAC,AAED,sBAAsB,4BAAC,CAAC,AACtB,aAAa,CAAE,IAAI,kBAAkB,CAAC,IAAI,CAAC,CAC3C,UAAU,CAAE,IAAI,cAAc,CAAC,QAAQ,CAAC,CACxC,KAAK,CAAE,IAAI,iBAAiB,CAAC,KAAK,CAAC,CACnC,MAAM,CAAE,IAAI,kBAAkB,CAAC,KAAK,CAAC,CACrC,QAAQ,CAAE,QAAQ,CAClB,GAAG,CAAE,IAAI,eAAe,CAAC,IAAI,CAAC,CAC9B,UAAU,CAAE,IAAI,qBAAqB,CAAC,OAAO,CAAC,CAC9C,OAAO,CAAE,IAAI,mBAAmB,CAAC,IAAI,CAAC,AACxC,CAAC,AAED,kDAAsB,MAAM,CAC5B,qBAAO,CAAC,sBAAsB,cAAC,CAAC,AAC9B,UAAU,CAAE,IAAI,mBAAmB,CAAC,KAAK,CAAC,AAC5C,CAAC,AAED,oCAAsB,MAAM,CAAC,iBAAG,CAChC,qBAAO,CAAC,sBAAsB,CAAC,GAAG,cAAC,CAAC,AAClC,IAAI,CAAE,IAAI,qBAAqB,CAAC,QAAQ,CAAC,AAC3C,CAAC,AAED,oCAAsB,CAAC,GAAG,cAAC,CAAC,AAC1B,IAAI,CAAE,IAAI,gBAAgB,CAAC,QAAQ,CAAC,CACpC,cAAc,CAAE,GAAG,AACrB,CAAC\"}"
};

const MultiSelection = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	const dispatch = createEventDispatcher();
	let { selectedValue = [] } = $$props;
	let { activeSelectedValue = undefined } = $$props;
	let { isDisabled = false } = $$props;
	let { getSelectionLabel = undefined } = $$props;

	if ($$props.selectedValue === void 0 && $$bindings.selectedValue && selectedValue !== void 0) $$bindings.selectedValue(selectedValue);
	if ($$props.activeSelectedValue === void 0 && $$bindings.activeSelectedValue && activeSelectedValue !== void 0) $$bindings.activeSelectedValue(activeSelectedValue);
	if ($$props.isDisabled === void 0 && $$bindings.isDisabled && isDisabled !== void 0) $$bindings.isDisabled(isDisabled);
	if ($$props.getSelectionLabel === void 0 && $$bindings.getSelectionLabel && getSelectionLabel !== void 0) $$bindings.getSelectionLabel(getSelectionLabel);
	$$result.css.add(css$b);

	return `${each(selectedValue, (value, i) => `<div class="${"multiSelectItem " + escape(activeSelectedValue === i ? "active" : "") + " " + escape(isDisabled ? "disabled" : "") + " svelte-rtzfov"}">
  <div class="${"multiSelectItem_label svelte-rtzfov"}">
    ${getSelectionLabel(value)}
  </div>
  ${!isDisabled
	? `<div class="${"multiSelectItem_clear svelte-rtzfov"}">
    <svg width="${"100%"}" height="${"100%"}" viewBox="${"-2 -2 50 50"}" focusable="${"false"}" role="${"presentation"}" class="${"svelte-rtzfov"}">
      <path d="${"M34.923,37.251L24,26.328L13.077,37.251L9.436,33.61l10.923-10.923L9.436,11.765l3.641-3.641L24,19.047L34.923,8.124 l3.641,3.641L27.641,22.688L38.564,33.61L34.923,37.251z"}"></path>
    </svg>
  </div>`
	: ``}
</div>`)}`;
});

function isOutOfViewport(elem) {
  const bounding = elem.getBoundingClientRect();
  const out = {};

  out.top = bounding.top < 0;
  out.left = bounding.left < 0;
  out.bottom = bounding.bottom > (window.innerHeight || document.documentElement.clientHeight);
  out.right = bounding.right > (window.innerWidth || document.documentElement.clientWidth);
  out.any = out.top || out.left || out.bottom || out.right;

  return out;
}

function debounce(func, wait, immediate) {
  let timeout;

  return function executedFunction() {
    let context = this;
    let args = arguments;
	    
    let later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    let callNow = immediate && !timeout;
	
    clearTimeout(timeout);

    timeout = setTimeout(later, wait);
	
    if (callNow) func.apply(context, args);
  };
}

/* node_modules/svelte-select/src/Select.svelte generated by Svelte v3.17.1 */

const css$c = {
	code: ".selectContainer.svelte-e3bo9s.svelte-e3bo9s{border:var(--border, 1px solid #D8DBDF);border-radius:var(--borderRadius, 3px);height:var(--height, 42px);position:relative;display:flex;padding:var(--padding, 0 16px);background:var(--background, #fff)}.selectContainer.svelte-e3bo9s input.svelte-e3bo9s{cursor:default;border:none;color:var(--inputColor, #3F4F5F);height:var(--height, 42px);line-height:var(--height, 42px);padding:var(--padding, 0 16px);width:100%;background:transparent;font-size:var(--inputFontSize, 14px);letter-spacing:var(--inputLetterSpacing, -0.08px);position:absolute;left:0}.selectContainer.svelte-e3bo9s input.svelte-e3bo9s::placeholder{color:var(--placeholderColor, #78848F)}.selectContainer.svelte-e3bo9s input.svelte-e3bo9s:focus{outline:none}.selectContainer.svelte-e3bo9s.svelte-e3bo9s:hover{border-color:var(--borderHoverColor, #b2b8bf)}.selectContainer.focused.svelte-e3bo9s.svelte-e3bo9s{border-color:var(--borderFocusColor, #006FE8)}.selectContainer.disabled.svelte-e3bo9s.svelte-e3bo9s{background:var(--disabledBackground, #EBEDEF);border-color:var(--disabledBorderColor, #EBEDEF);color:var(--disabledColor, #C1C6CC)}.selectContainer.disabled.svelte-e3bo9s input.svelte-e3bo9s::placeholder{color:var(--disabledPlaceholderColor, #C1C6CC)}.selectedItem.svelte-e3bo9s.svelte-e3bo9s{line-height:var(--height, 42px);height:var(--height, 42px);overflow-x:hidden;padding:var(--selectedItemPadding, 0 20px 0 0)}.selectedItem.svelte-e3bo9s.svelte-e3bo9s:focus{outline:none}.clearSelect.svelte-e3bo9s.svelte-e3bo9s{position:absolute;right:var(--clearSelectRight, 10px);top:var(--clearSelectTop, 11px);bottom:var(--clearSelectBottom, 11px);width:var(--clearSelectWidth, 20px);color:var(--clearSelectColor, #c5cacf);flex:none !important}.clearSelect.svelte-e3bo9s.svelte-e3bo9s:hover{color:var(--clearSelectHoverColor, #2c3e50)}.selectContainer.focused.svelte-e3bo9s .clearSelect.svelte-e3bo9s{color:var(--clearSelectFocusColor, #3F4F5F)\n  }.indicator.svelte-e3bo9s.svelte-e3bo9s{position:absolute;right:var(--indicatorRight, 10px);top:var(--indicatorTop, 11px);width:var(--indicatorWidth, 20px);height:var(--indicatorHeight, 20px);color:var(--indicatorColor, #c5cacf)}.indicator.svelte-e3bo9s svg.svelte-e3bo9s{display:inline-block;fill:var(--indicatorFill, currentcolor);line-height:1;stroke:var(--indicatorStroke, currentcolor);stroke-width:0}.spinner.svelte-e3bo9s.svelte-e3bo9s{position:absolute;right:var(--spinnerRight, 10px);top:var(--spinnerLeft, 11px);width:var(--spinnerWidth, 20px);height:var(--spinnerHeight, 20px);color:var(--spinnerColor, #51ce6c);animation:svelte-e3bo9s-rotate 0.75s linear infinite}.spinner_icon.svelte-e3bo9s.svelte-e3bo9s{display:block;height:100%;transform-origin:center center;width:100%;position:absolute;top:0;bottom:0;left:0;right:0;margin:auto;-webkit-transform:none}.spinner_path.svelte-e3bo9s.svelte-e3bo9s{stroke-dasharray:90;stroke-linecap:round}.multiSelect.svelte-e3bo9s.svelte-e3bo9s{display:flex;padding:var(--multiSelectPadding, 0 35px 0 16px);height:auto;flex-wrap:wrap}.multiSelect.svelte-e3bo9s>.svelte-e3bo9s{flex:1 1 50px}.selectContainer.multiSelect.svelte-e3bo9s input.svelte-e3bo9s{padding:var(--multiSelectInputPadding, 0);position:relative;margin:var(--multiSelectInputMargin, 0)}.hasError.svelte-e3bo9s.svelte-e3bo9s{border:var(--errorBorder, 1px solid #FF2D55)}@keyframes svelte-e3bo9s-rotate{100%{transform:rotate(360deg)}}",
	map: "{\"version\":3,\"file\":\"Select.svelte\",\"sources\":[\"Select.svelte\"],\"sourcesContent\":[\"<script>\\n  import { beforeUpdate, createEventDispatcher, onDestroy, onMount, tick } from 'svelte';\\n  import List from './List.svelte';\\n  import ItemComponent from './Item.svelte';\\n  import SelectionComponent from './Selection.svelte';\\n  import MultiSelectionComponent from './MultiSelection.svelte';\\n  import isOutOfViewport from './utils/isOutOfViewport';\\n  import debounce from './utils/debounce';\\n\\n  const dispatch = createEventDispatcher();\\n  export let container = undefined;\\n  export let input = undefined;\\n  export let Item = ItemComponent;\\n  export let Selection = SelectionComponent;\\n  export let MultiSelection = MultiSelectionComponent;\\n  export let isMulti = false;\\n  export let isDisabled = false;\\n  export let isCreatable = false;\\n  export let isFocused = false;\\n  export let selectedValue = undefined;\\n  export let filterText = '';\\n  export let placeholder = 'Select...';\\n  export let items = [];\\n  export let itemFilter = (label, filterText, option) => label.toLowerCase().includes(filterText.toLowerCase());\\n  export let groupBy = undefined;\\n  export let groupFilter = (groups) => groups;\\n  export let isGroupHeaderSelectable = false;\\n  export let getGroupHeaderLabel = (option) => {\\n    return option.label\\n  };\\n  export let getOptionLabel = (option, filterText) => {\\n    return option.isCreator ? `Create \\\\\\\"${filterText}\\\\\\\"` : option.label;\\n  };\\n  export let optionIdentifier = 'value';\\n  export let loadOptions = undefined;\\n  export let hasError = false;\\n  export let containerStyles = '';\\n  export let getSelectionLabel = (option) => {\\n    if (option) return option.label\\n  };\\n\\n  export let createGroupHeaderItem = (groupValue) => {\\n    return {\\n      value: groupValue,\\n      label: groupValue\\n    }\\n  };\\n\\n  export let createItem = (filterText) => {\\n    return {\\n      value: filterText,\\n      label: filterText\\n    };\\n  };\\n\\n  export let isSearchable = true;\\n  export let inputStyles = '';\\n  export let isClearable = true;\\n  export let isWaiting = false;\\n  export let listPlacement = 'auto';\\n  export let listOpen = false;\\n  export let list = undefined;\\n  export let isVirtualList = false;\\n  export let loadOptionsInterval = 300;\\n  export let noOptionsMessage = 'No options';\\n  export let hideEmptyState = false;\\n  export let filteredItems = [];\\n  export let inputAttributes = {};\\n  export let listAutoWidth = true;\\n  export let itemHeight = 40;\\n  \\n\\n  let target;\\n  let activeSelectedValue;\\n  let _items = [];\\n  let originalItemsClone;\\n  let containerClasses = '';\\n  let prev_selectedValue;\\n  let prev_listOpen;\\n  let prev_filterText;\\n  let prev_isFocused;\\n  let prev_filteredItems;\\n\\n  async function resetFilter() {\\n    await tick();\\n    filterText = '';\\n  }\\n\\n  const getItems = debounce(async () => {\\n    isWaiting = true;\\n    \\n    items = await loadOptions(filterText);\\n  \\n    isWaiting = false;\\n    isFocused = true;\\n    listOpen = true;\\n  }, loadOptionsInterval);\\n\\n  $:disabled = isDisabled;\\n\\n  $: {\\n    containerClasses = `selectContainer`;\\n    containerClasses += isMulti ? ' multiSelect' : '';\\n    containerClasses += isDisabled ? ' disabled' : '';\\n    containerClasses += isFocused ? ' focused' : '';\\n  }\\n\\n  $: {\\n    if (typeof selectedValue === 'string') {\\n      selectedValue = { [optionIdentifier]: selectedValue, label: selectedValue }\\n    }\\n  }\\n\\n  $: showSelectedItem = selectedValue && filterText.length === 0;\\n\\n  $: placeholderText = selectedValue ? '' : placeholder;\\n\\n  let _inputAttributes = {};\\n  $: {\\n    _inputAttributes = Object.assign(inputAttributes, {\\n      autocomplete: 'off',\\n      autocorrect: 'off',\\n      spellcheck: false\\n    })\\n\\n    if (!isSearchable) {\\n      _inputAttributes.readonly = true;\\n    }\\n  }\\n\\n  $: {\\n    let _filteredItems;\\n    let _items = items;\\n\\n    if (items && items.length > 0 && typeof items[0] !== 'object') {\\n      _items = items.map((item, index) => {\\n        return {\\n          index,\\n          value: item,\\n          label: item\\n        }\\n      })\\n    }\\n\\n    if (loadOptions && filterText.length === 0 && originalItemsClone) {\\n      _filteredItems = JSON.parse(originalItemsClone);\\n      _items = JSON.parse(originalItemsClone);\\n    } else {\\n      _filteredItems = loadOptions ? filterText.length === 0 ? [] : _items : _items.filter(item => {\\n\\n        let keepItem = true;\\n\\n        if (isMulti && selectedValue) {\\n          keepItem = !selectedValue.find((value) => {\\n            return value[optionIdentifier] === item[optionIdentifier]\\n          });\\n        }\\n\\n        if (!keepItem) return false;\\n        if (filterText.length < 1) return true;\\n        return itemFilter(getOptionLabel(item, filterText), filterText, item);\\n      });\\n    }\\n\\n    if (groupBy) {\\n      const groupValues = [];\\n      const groups = {};\\n\\n      _filteredItems.forEach((item) => {\\n        const groupValue = groupBy(item);\\n\\n        if (!groupValues.includes(groupValue)) {\\n          groupValues.push(groupValue);\\n          groups[groupValue] = [];\\n\\n          if(groupValue) {\\n            groups[groupValue].push(Object.assign(\\n              createGroupHeaderItem(groupValue, item), \\n              { \\n                id: groupValue, \\n                isGroupHeader: true, \\n                isSelectable: isGroupHeaderSelectable\\n              }\\n            ));\\n          }\\n        }\\n        \\n        groups[groupValue].push(Object.assign({ isGroupItem: !!groupValue }, item));\\n      });\\n\\n      const sortedGroupedItems = [];\\n\\n      groupFilter(groupValues).forEach((groupValue) => {\\n        sortedGroupedItems.push(...groups[groupValue]);\\n      });\\n\\n      filteredItems = sortedGroupedItems;\\n    } else {\\n      filteredItems = _filteredItems;\\n    }\\n  }\\n\\n  beforeUpdate(() => {\\n    if (isMulti && selectedValue && selectedValue.length > 1) {\\n      checkSelectedValueForDuplicates();\\n    }\\n\\n    if (!isMulti && selectedValue && prev_selectedValue !== selectedValue) {\\n      if (!prev_selectedValue || JSON.stringify(selectedValue[optionIdentifier]) !== JSON.stringify(prev_selectedValue[optionIdentifier])) {\\n        dispatch('select', selectedValue);\\n      }\\n    }\\n\\n    if (isMulti && JSON.stringify(selectedValue) !== JSON.stringify(prev_selectedValue)) {\\n      if (checkSelectedValueForDuplicates()) {\\n        dispatch('select', selectedValue);\\n      }\\n    }\\n\\n    if (container && listOpen !== prev_listOpen) {\\n      if (listOpen) {\\n        loadList();\\n      } else {\\n        removeList();\\n      }\\n    }\\n\\n    if (filterText !== prev_filterText) {\\n      if (filterText.length > 0) {\\n        isFocused = true;\\n        listOpen = true;\\n\\n        if (loadOptions) {\\n          getItems();\\n        } else {\\n          loadList();\\n          listOpen = true;\\n\\n          if (isMulti) {\\n            activeSelectedValue = undefined\\n          }\\n        }\\n      } else {\\n        setList([])\\n      }\\n\\n      if (list) {\\n        list.$set({\\n          filterText\\n        });\\n      }\\n    }\\n\\n    if (isFocused !== prev_isFocused) {\\n      if (isFocused || listOpen) {\\n        handleFocus();\\n      } else {\\n        resetFilter();\\n        if (input) input.blur();\\n      }\\n    }\\n\\n    if (prev_filteredItems !== filteredItems) {\\n      let _filteredItems = [...filteredItems];\\n\\n      if (isCreatable && filterText) {\\n        const itemToCreate = createItem(filterText);\\n        itemToCreate.isCreator = true;\\n\\n        const existingItemWithFilterValue = _filteredItems.find((item) => {\\n          return item[optionIdentifier] === itemToCreate[optionIdentifier];\\n        });\\n\\n        let existingSelectionWithFilterValue;\\n\\n        if (selectedValue) {\\n          if (isMulti) {\\n            existingSelectionWithFilterValue = selectedValue.find((selection) => {\\n              return selection[optionIdentifier] === itemToCreate[optionIdentifier];\\n            });\\n          } else if (selectedValue[optionIdentifier] === itemToCreate[optionIdentifier]) {\\n            existingSelectionWithFilterValue = selectedValue;\\n          }\\n        }\\n\\n        if (!existingItemWithFilterValue && !existingSelectionWithFilterValue) {\\n          _filteredItems = [..._filteredItems, itemToCreate];\\n        }\\n      }\\n\\n      setList(_filteredItems);\\n    }\\n\\n    prev_selectedValue = selectedValue;\\n    prev_listOpen = listOpen;\\n    prev_filterText = filterText;\\n    prev_isFocused = isFocused;\\n    prev_filteredItems = filteredItems;\\n  });\\n\\n  function checkSelectedValueForDuplicates() {\\n    let noDuplicates = true;\\n    if (selectedValue) {\\n      const ids = [];\\n      const uniqueValues = [];\\n\\n      selectedValue.forEach(val => {\\n        if (!ids.includes(val[optionIdentifier])) {\\n          ids.push(val[optionIdentifier]);\\n          uniqueValues.push(val);\\n        } else {\\n          noDuplicates = false;\\n        }\\n      })\\n\\n      selectedValue = uniqueValues\\n    }\\n    return noDuplicates;\\n  }\\n\\n  async function setList(items) {\\n    await tick();\\n    if (list) return list.$set({ items })\\n    if (loadOptions && items.length > 0) loadList();\\n  }\\n\\n  function handleMultiItemClear(event) {\\n    const { detail } = event;\\n    const itemToRemove = selectedValue[detail ? detail.i : selectedValue.length - 1];\\n\\n    if (selectedValue.length === 1) {\\n      selectedValue = undefined;\\n    } else {\\n      selectedValue = selectedValue.filter((item) => {\\n        return item !== itemToRemove;\\n      });\\n    }\\n\\n    dispatch('clear', itemToRemove);\\n    \\n    getPosition();\\n  }\\n\\n  async function getPosition() {\\n    await tick();\\n    if (!target || !container) return;\\n    const { top, height, width } = container.getBoundingClientRect();\\n\\n    target.style['min-width'] = `${width}px`;\\n    target.style.width = `${listAutoWidth ? 'auto' : '100%'}`;\\n    target.style.left = '0';\\n\\n    if (listPlacement === 'top') {\\n      target.style.bottom = `${height + 5}px`;\\n    } else {\\n      target.style.top = `${height + 5}px`;\\n    }\\n\\n    target = target;\\n\\n    if (listPlacement === 'auto' && isOutOfViewport(target).bottom) {\\n      target.style.top = ``;\\n      target.style.bottom = `${height + 5}px`;\\n    }\\n\\n    target.style.visibility = '';\\n  }\\n\\n  function handleKeyDown(e) {\\n    if (!isFocused) return;\\n\\n    switch (e.key) {\\n      case 'ArrowDown':\\n        e.preventDefault();\\n        listOpen = true;\\n        activeSelectedValue = undefined;\\n        break;\\n      case 'ArrowUp':\\n        e.preventDefault();\\n        listOpen = true;\\n        activeSelectedValue = undefined;\\n        break;\\n      case 'Tab':\\n        if (!listOpen) isFocused = false;\\n        break;\\n      case 'Backspace':\\n        if (!isMulti || filterText.length > 0) return;\\n        if (isMulti && selectedValue && selectedValue.length > 0) {\\n          handleMultiItemClear(activeSelectedValue !== undefined ? activeSelectedValue : selectedValue.length - 1);\\n          if (activeSelectedValue === 0 || activeSelectedValue === undefined) break;\\n          activeSelectedValue = selectedValue.length > activeSelectedValue ? activeSelectedValue - 1 : undefined;\\n        }\\n        break;\\n      case 'ArrowLeft':\\n        if (list) list.$set({ hoverItemIndex: -1 });\\n        if (!isMulti || filterText.length > 0) return;\\n\\n        if (activeSelectedValue === undefined) {\\n          activeSelectedValue = selectedValue.length - 1;\\n        } else if (selectedValue.length > activeSelectedValue && activeSelectedValue !== 0) {\\n          activeSelectedValue -= 1\\n        }\\n        break;\\n      case 'ArrowRight':\\n        if (list) list.$set({ hoverItemIndex: -1 });\\n        if (!isMulti || filterText.length > 0 || activeSelectedValue === undefined) return;\\n        if (activeSelectedValue === selectedValue.length - 1) {\\n          activeSelectedValue = undefined;\\n        } else if (activeSelectedValue < selectedValue.length - 1) {\\n          activeSelectedValue += 1;\\n        }\\n        break;\\n    }\\n  }\\n\\n  function handleFocus() {\\n    isFocused = true;\\n    if (input) input.focus();\\n  }\\n\\n  function removeList() {\\n    resetFilter();\\n    activeSelectedValue = undefined;\\n\\n    if (!list) return;\\n    list.$destroy();\\n    list = undefined;\\n\\n    if (!target) return;\\n    if (target.parentNode) target.parentNode.removeChild(target);\\n    target = undefined;\\n\\n    list = list;\\n    target = target;\\n  }\\n\\n  function handleWindowClick(event) {\\n    if (!container) return;\\n    const eventTarget = event.path && (event.path.length > 0) ? event.path[0] : event.target\\n    if (container.contains(eventTarget)) return;\\n    isFocused = false;\\n    listOpen = false;\\n    activeSelectedValue = undefined;\\n    if (input) input.blur();\\n  }\\n\\n  function handleClick() {\\n    if (isDisabled) return;\\n    isFocused = true;\\n    listOpen = !listOpen;\\n  }\\n\\n  export function handleClear() {\\n    selectedValue = undefined;\\n    listOpen = false;\\n    dispatch('clear', selectedValue);\\n    handleFocus();\\n  }\\n\\n  async function loadList() {\\n    await tick();\\n    if (target && list) return;\\n\\n    const data = {\\n      Item,\\n      filterText,\\n      optionIdentifier,\\n      noOptionsMessage,\\n      hideEmptyState,\\n      isVirtualList,\\n      selectedValue,\\n      isMulti,\\n      getGroupHeaderLabel,\\n      items: filteredItems,\\n      itemHeight\\n    };\\n\\n    if (getOptionLabel) {\\n      data.getOptionLabel = getOptionLabel;\\n    }\\n\\n    target = document.createElement('div');\\n\\n    Object.assign(target.style, {\\n      position: 'absolute',\\n      'z-index': 2,\\n      'visibility': 'hidden'\\n    });\\n\\n    list = list;\\n    target = target;\\n    if (container) container.appendChild(target);\\n\\n    list = new List({\\n      target,\\n      props: data\\n    });\\n\\n    list.$on('itemSelected', (event) => {\\n      const { detail } = event;\\n\\n      if (detail) {\\n        const item = Object.assign({}, detail);\\n\\n        if (isMulti) {\\n          selectedValue = selectedValue ? selectedValue.concat([item]) : [item];\\n        } else {\\n          selectedValue = item;\\n        }\\n\\n        resetFilter();\\n        selectedValue = selectedValue;\\n\\n        setTimeout(() => {\\n          listOpen = false;\\n          activeSelectedValue = undefined;\\n        });\\n      }\\n    });\\n\\n    list.$on('itemCreated', (event) => {\\n      const { detail } = event;\\n      if (isMulti) {\\n        selectedValue = selectedValue || [];\\n        selectedValue = [...selectedValue, createItem(detail)]\\n      } else {\\n        selectedValue = createItem(detail)\\n      }\\n\\n      filterText = '';\\n      listOpen = false;\\n      activeSelectedValue = undefined;\\n      resetFilter();\\n    });\\n    \\n    list.$on('closeList', () => {\\n      listOpen = false;\\n    });\\n  \\n    list = list,\\n    target = target;\\n    getPosition();\\n  }\\n\\n  onMount(() => {\\n    if (isFocused) input.focus();\\n    if (listOpen) loadList();\\n\\n    if (items && items.length > 0) {\\n      originalItemsClone = JSON.stringify(items);\\n    }\\n\\n    if (selectedValue) {\\n      if (isMulti) {\\n        selectedValue = selectedValue.map(item => {\\n          if (typeof item === 'string') {\\n            return { value: item, label: item }\\n          } else {\\n            return item;\\n          }\\n        })\\n      }\\n    }\\n  });\\n\\n  onDestroy(() => {\\n    removeList()\\n  });\\n</script>\\n\\n<svelte:window on:click=\\\"{handleWindowClick}\\\" on:keydown=\\\"{handleKeyDown}\\\" on:resize=\\\"{getPosition}\\\" />\\n\\n<div class=\\\"{containerClasses} {hasError ? 'hasError' : ''}\\\" style=\\\"{containerStyles}\\\" on:click=\\\"{handleClick}\\\"\\n  bind:this={container}>\\n\\n  {#if isMulti && selectedValue && selectedValue.length > 0}\\n  <svelte:component\\n    this=\\\"{MultiSelection}\\\"\\n    {selectedValue}\\n    {getSelectionLabel}\\n    {activeSelectedValue}\\n    {isDisabled}\\n    on:multiItemClear=\\\"{handleMultiItemClear}\\\"\\n    on:focus=\\\"{handleFocus}\\\"\\n  />\\n  {/if}\\n\\n\\n  {#if isDisabled}\\n    <input\\n      {..._inputAttributes}\\n      bind:this={input}\\n      on:focus=\\\"{handleFocus}\\\"\\n      bind:value=\\\"{filterText}\\\"    \\n      placeholder=\\\"{placeholderText}\\\"\\n      style=\\\"{inputStyles}\\\"\\n      disabled\\n    >\\n  {:else}\\n    <input\\n      {..._inputAttributes}\\n      bind:this={input}\\n      on:focus=\\\"{handleFocus}\\\"\\n      bind:value=\\\"{filterText}\\\"    \\n      placeholder=\\\"{placeholderText}\\\"\\n      style=\\\"{inputStyles}\\\"\\n    >\\n  {/if}\\n\\n  {#if !isMulti && showSelectedItem }\\n  <div class=\\\"selectedItem\\\" on:focus=\\\"{handleFocus}\\\">\\n    <svelte:component this=\\\"{Selection}\\\" item={selectedValue} {getSelectionLabel}/>\\n  </div>\\n  {/if}\\n\\n  {#if showSelectedItem && isClearable && !isDisabled && !isWaiting}\\n  <div class=\\\"clearSelect\\\" on:click|preventDefault=\\\"{handleClear}\\\">\\n    <svg width=\\\"100%\\\" height=\\\"100%\\\" viewBox=\\\"-2 -2 50 50\\\" focusable=\\\"false\\\"\\n         role=\\\"presentation\\\">\\n      <path fill=\\\"currentColor\\\"\\n            d=\\\"M34.923,37.251L24,26.328L13.077,37.251L9.436,33.61l10.923-10.923L9.436,11.765l3.641-3.641L24,19.047L34.923,8.124 l3.641,3.641L27.641,22.688L38.564,33.61L34.923,37.251z\\\"></path>\\n    </svg>\\n  </div>\\n  {/if}\\n\\n  {#if !isSearchable && !isDisabled && !isWaiting && (showSelectedItem && !isClearable || !showSelectedItem)}\\n  <div class=\\\"indicator\\\">\\n    <svg width=\\\"100%\\\" height=\\\"100%\\\" viewBox=\\\"0 0 20 20\\\" focusable=\\\"false\\\" class=\\\"css-19bqh2r\\\">\\n      <path\\n        d=\\\"M4.516 7.548c0.436-0.446 1.043-0.481 1.576 0l3.908 3.747 3.908-3.747c0.533-0.481 1.141-0.446 1.574 0 0.436 0.445 0.408 1.197 0 1.615-0.406 0.418-4.695 4.502-4.695 4.502-0.217 0.223-0.502 0.335-0.787 0.335s-0.57-0.112-0.789-0.335c0 0-4.287-4.084-4.695-4.502s-0.436-1.17 0-1.615z\\\"></path>\\n    </svg>\\n  </div>\\n  {/if}\\n\\n  {#if isWaiting}\\n  <div class=\\\"spinner\\\">\\n    <svg class=\\\"spinner_icon\\\" viewBox=\\\"25 25 50 50\\\">\\n      <circle class=\\\"spinner_path\\\" cx=\\\"50\\\" cy=\\\"50\\\" r=\\\"20\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"5\\\"\\n              stroke-miterlimit=\\\"10\\\"></circle>\\n    </svg>\\n  </div>\\n  {/if}\\n</div>\\n\\n<style>\\n  .selectContainer {\\n    border: var(--border, 1px solid #D8DBDF);\\n    border-radius: var(--borderRadius, 3px);\\n    height: var(--height, 42px);\\n    position: relative;\\n    display: flex;\\n    padding: var(--padding, 0 16px);\\n    background: var(--background, #fff);\\n  }\\n\\n  .selectContainer input {\\n    cursor: default;\\n    border: none;\\n    color: var(--inputColor, #3F4F5F);\\n    height: var(--height, 42px);\\n    line-height: var(--height, 42px);\\n    padding: var(--padding, 0 16px);\\n    width: 100%;\\n    background: transparent;\\n    font-size: var(--inputFontSize, 14px);\\n    letter-spacing: var(--inputLetterSpacing, -0.08px);\\n    position: absolute;\\n    left: 0;\\n  }\\n\\n  .selectContainer input::placeholder {\\n    color: var(--placeholderColor, #78848F);\\n  }\\n\\n  .selectContainer input:focus {\\n    outline: none;\\n  }\\n\\n  .selectContainer:hover {\\n    border-color: var(--borderHoverColor, #b2b8bf);\\n  }\\n\\n  .selectContainer.focused {\\n    border-color: var(--borderFocusColor, #006FE8);\\n  }\\n\\n  .selectContainer.disabled {\\n    background: var(--disabledBackground, #EBEDEF);\\n    border-color: var(--disabledBorderColor, #EBEDEF);\\n    color: var(--disabledColor, #C1C6CC);\\n  }\\n\\n  .selectContainer.disabled input::placeholder {\\n    color: var(--disabledPlaceholderColor, #C1C6CC);\\n  }\\n\\n  .selectedItem {\\n    line-height: var(--height, 42px);\\n    height: var(--height, 42px);\\n    overflow-x: hidden;\\n    padding: var(--selectedItemPadding, 0 20px 0 0);\\n  }\\n\\n  .selectedItem:focus {\\n    outline: none;\\n  }\\n\\n  .clearSelect {\\n    position: absolute;\\n    right: var(--clearSelectRight, 10px);\\n    top: var(--clearSelectTop, 11px);\\n    bottom: var(--clearSelectBottom, 11px);\\n    width: var(--clearSelectWidth, 20px);\\n    color: var(--clearSelectColor, #c5cacf);\\n    flex: none !important;\\n  }\\n\\n  .clearSelect:hover {\\n    color: var(--clearSelectHoverColor, #2c3e50);\\n  }\\n\\n  .selectContainer.focused .clearSelect {\\n    color: var(--clearSelectFocusColor, #3F4F5F)\\n  }\\n\\n  .indicator {\\n    position: absolute;\\n    right: var(--indicatorRight, 10px);\\n    top: var(--indicatorTop, 11px);\\n    width: var(--indicatorWidth, 20px);\\n    height: var(--indicatorHeight, 20px);\\n    color: var(--indicatorColor, #c5cacf);\\n  }\\n\\n  .indicator svg {\\n    display: inline-block;\\n    fill: var(--indicatorFill, currentcolor);\\n    line-height: 1;\\n    stroke: var(--indicatorStroke, currentcolor);\\n    stroke-width: 0;\\n  }\\n\\n  .spinner {\\n    position: absolute;\\n    right: var(--spinnerRight, 10px);\\n    top: var(--spinnerLeft, 11px);\\n    width: var(--spinnerWidth, 20px);\\n    height: var(--spinnerHeight, 20px);\\n    color: var(--spinnerColor, #51ce6c);\\n    animation: rotate 0.75s linear infinite;\\n  }\\n\\n  .spinner_icon {\\n    display: block;\\n    height: 100%;\\n    transform-origin: center center;\\n    width: 100%;\\n    position: absolute;\\n    top: 0;\\n    bottom: 0;\\n    left: 0;\\n    right: 0;\\n    margin: auto;\\n    -webkit-transform: none;\\n  }\\n\\n  .spinner_path {\\n    stroke-dasharray: 90;\\n    stroke-linecap: round;\\n  }\\n\\n  .multiSelect {\\n    display: flex;\\n    padding: var(--multiSelectPadding, 0 35px 0 16px);\\n    height: auto;\\n    flex-wrap: wrap;\\n  }\\n\\n  .multiSelect > * {\\n    flex: 1 1 50px;\\n  }\\n\\n  .selectContainer.multiSelect input {\\n    padding: var(--multiSelectInputPadding, 0);\\n    position: relative;\\n    margin: var(--multiSelectInputMargin, 0);\\n  }\\n\\n  .hasError {\\n    border: var(--errorBorder, 1px solid #FF2D55);\\n  }\\n\\n  @keyframes rotate {\\n    100% {\\n      transform: rotate(360deg);\\n    }\\n  }\\n</style>\\n\"],\"names\":[],\"mappings\":\"AAqoBE,gBAAgB,4BAAC,CAAC,AAChB,MAAM,CAAE,IAAI,QAAQ,CAAC,kBAAkB,CAAC,CACxC,aAAa,CAAE,IAAI,cAAc,CAAC,IAAI,CAAC,CACvC,MAAM,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAC3B,QAAQ,CAAE,QAAQ,CAClB,OAAO,CAAE,IAAI,CACb,OAAO,CAAE,IAAI,SAAS,CAAC,OAAO,CAAC,CAC/B,UAAU,CAAE,IAAI,YAAY,CAAC,KAAK,CAAC,AACrC,CAAC,AAED,8BAAgB,CAAC,KAAK,cAAC,CAAC,AACtB,MAAM,CAAE,OAAO,CACf,MAAM,CAAE,IAAI,CACZ,KAAK,CAAE,IAAI,YAAY,CAAC,QAAQ,CAAC,CACjC,MAAM,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAC3B,WAAW,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAChC,OAAO,CAAE,IAAI,SAAS,CAAC,OAAO,CAAC,CAC/B,KAAK,CAAE,IAAI,CACX,UAAU,CAAE,WAAW,CACvB,SAAS,CAAE,IAAI,eAAe,CAAC,KAAK,CAAC,CACrC,cAAc,CAAE,IAAI,oBAAoB,CAAC,QAAQ,CAAC,CAClD,QAAQ,CAAE,QAAQ,CAClB,IAAI,CAAE,CAAC,AACT,CAAC,AAED,8BAAgB,CAAC,mBAAK,aAAa,AAAC,CAAC,AACnC,KAAK,CAAE,IAAI,kBAAkB,CAAC,QAAQ,CAAC,AACzC,CAAC,AAED,8BAAgB,CAAC,mBAAK,MAAM,AAAC,CAAC,AAC5B,OAAO,CAAE,IAAI,AACf,CAAC,AAED,4CAAgB,MAAM,AAAC,CAAC,AACtB,YAAY,CAAE,IAAI,kBAAkB,CAAC,QAAQ,CAAC,AAChD,CAAC,AAED,gBAAgB,QAAQ,4BAAC,CAAC,AACxB,YAAY,CAAE,IAAI,kBAAkB,CAAC,QAAQ,CAAC,AAChD,CAAC,AAED,gBAAgB,SAAS,4BAAC,CAAC,AACzB,UAAU,CAAE,IAAI,oBAAoB,CAAC,QAAQ,CAAC,CAC9C,YAAY,CAAE,IAAI,qBAAqB,CAAC,QAAQ,CAAC,CACjD,KAAK,CAAE,IAAI,eAAe,CAAC,QAAQ,CAAC,AACtC,CAAC,AAED,gBAAgB,uBAAS,CAAC,mBAAK,aAAa,AAAC,CAAC,AAC5C,KAAK,CAAE,IAAI,0BAA0B,CAAC,QAAQ,CAAC,AACjD,CAAC,AAED,aAAa,4BAAC,CAAC,AACb,WAAW,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAChC,MAAM,CAAE,IAAI,QAAQ,CAAC,KAAK,CAAC,CAC3B,UAAU,CAAE,MAAM,CAClB,OAAO,CAAE,IAAI,qBAAqB,CAAC,WAAW,CAAC,AACjD,CAAC,AAED,yCAAa,MAAM,AAAC,CAAC,AACnB,OAAO,CAAE,IAAI,AACf,CAAC,AAED,YAAY,4BAAC,CAAC,AACZ,QAAQ,CAAE,QAAQ,CAClB,KAAK,CAAE,IAAI,kBAAkB,CAAC,KAAK,CAAC,CACpC,GAAG,CAAE,IAAI,gBAAgB,CAAC,KAAK,CAAC,CAChC,MAAM,CAAE,IAAI,mBAAmB,CAAC,KAAK,CAAC,CACtC,KAAK,CAAE,IAAI,kBAAkB,CAAC,KAAK,CAAC,CACpC,KAAK,CAAE,IAAI,kBAAkB,CAAC,QAAQ,CAAC,CACvC,IAAI,CAAE,IAAI,CAAC,UAAU,AACvB,CAAC,AAED,wCAAY,MAAM,AAAC,CAAC,AAClB,KAAK,CAAE,IAAI,uBAAuB,CAAC,QAAQ,CAAC,AAC9C,CAAC,AAED,gBAAgB,sBAAQ,CAAC,YAAY,cAAC,CAAC,AACrC,KAAK,CAAE,IAAI,uBAAuB,CAAC,QAAQ,CAAC;EAC9C,CAAC,AAED,UAAU,4BAAC,CAAC,AACV,QAAQ,CAAE,QAAQ,CAClB,KAAK,CAAE,IAAI,gBAAgB,CAAC,KAAK,CAAC,CAClC,GAAG,CAAE,IAAI,cAAc,CAAC,KAAK,CAAC,CAC9B,KAAK,CAAE,IAAI,gBAAgB,CAAC,KAAK,CAAC,CAClC,MAAM,CAAE,IAAI,iBAAiB,CAAC,KAAK,CAAC,CACpC,KAAK,CAAE,IAAI,gBAAgB,CAAC,QAAQ,CAAC,AACvC,CAAC,AAED,wBAAU,CAAC,GAAG,cAAC,CAAC,AACd,OAAO,CAAE,YAAY,CACrB,IAAI,CAAE,IAAI,eAAe,CAAC,aAAa,CAAC,CACxC,WAAW,CAAE,CAAC,CACd,MAAM,CAAE,IAAI,iBAAiB,CAAC,aAAa,CAAC,CAC5C,YAAY,CAAE,CAAC,AACjB,CAAC,AAED,QAAQ,4BAAC,CAAC,AACR,QAAQ,CAAE,QAAQ,CAClB,KAAK,CAAE,IAAI,cAAc,CAAC,KAAK,CAAC,CAChC,GAAG,CAAE,IAAI,aAAa,CAAC,KAAK,CAAC,CAC7B,KAAK,CAAE,IAAI,cAAc,CAAC,KAAK,CAAC,CAChC,MAAM,CAAE,IAAI,eAAe,CAAC,KAAK,CAAC,CAClC,KAAK,CAAE,IAAI,cAAc,CAAC,QAAQ,CAAC,CACnC,SAAS,CAAE,oBAAM,CAAC,KAAK,CAAC,MAAM,CAAC,QAAQ,AACzC,CAAC,AAED,aAAa,4BAAC,CAAC,AACb,OAAO,CAAE,KAAK,CACd,MAAM,CAAE,IAAI,CACZ,gBAAgB,CAAE,MAAM,CAAC,MAAM,CAC/B,KAAK,CAAE,IAAI,CACX,QAAQ,CAAE,QAAQ,CAClB,GAAG,CAAE,CAAC,CACN,MAAM,CAAE,CAAC,CACT,IAAI,CAAE,CAAC,CACP,KAAK,CAAE,CAAC,CACR,MAAM,CAAE,IAAI,CACZ,iBAAiB,CAAE,IAAI,AACzB,CAAC,AAED,aAAa,4BAAC,CAAC,AACb,gBAAgB,CAAE,EAAE,CACpB,cAAc,CAAE,KAAK,AACvB,CAAC,AAED,YAAY,4BAAC,CAAC,AACZ,OAAO,CAAE,IAAI,CACb,OAAO,CAAE,IAAI,oBAAoB,CAAC,cAAc,CAAC,CACjD,MAAM,CAAE,IAAI,CACZ,SAAS,CAAE,IAAI,AACjB,CAAC,AAED,0BAAY,CAAG,cAAE,CAAC,AAChB,IAAI,CAAE,CAAC,CAAC,CAAC,CAAC,IAAI,AAChB,CAAC,AAED,gBAAgB,0BAAY,CAAC,KAAK,cAAC,CAAC,AAClC,OAAO,CAAE,IAAI,yBAAyB,CAAC,EAAE,CAAC,CAC1C,QAAQ,CAAE,QAAQ,CAClB,MAAM,CAAE,IAAI,wBAAwB,CAAC,EAAE,CAAC,AAC1C,CAAC,AAED,SAAS,4BAAC,CAAC,AACT,MAAM,CAAE,IAAI,aAAa,CAAC,kBAAkB,CAAC,AAC/C,CAAC,AAED,WAAW,oBAAO,CAAC,AACjB,IAAI,AAAC,CAAC,AACJ,SAAS,CAAE,OAAO,MAAM,CAAC,AAC3B,CAAC,AACH,CAAC\"}"
};

const Select = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	const dispatch = createEventDispatcher();
	let { container = undefined } = $$props;
	let { input = undefined } = $$props;
	let { Item: Item$1 = Item } = $$props;
	let { Selection: Selection$1 = Selection } = $$props;
	let { MultiSelection: MultiSelection$1 = MultiSelection } = $$props;
	let { isMulti = false } = $$props;
	let { isDisabled = false } = $$props;
	let { isCreatable = false } = $$props;
	let { isFocused = false } = $$props;
	let { selectedValue = undefined } = $$props;
	let { filterText = "" } = $$props;
	let { placeholder = "Select..." } = $$props;
	let { items = [] } = $$props;
	let { itemFilter = (label, filterText, option) => label.toLowerCase().includes(filterText.toLowerCase()) } = $$props;
	let { groupBy = undefined } = $$props;
	let { groupFilter = groups => groups } = $$props;
	let { isGroupHeaderSelectable = false } = $$props;

	let { getGroupHeaderLabel = option => {
		return option.label;
	} } = $$props;

	let { getOptionLabel = (option, filterText) => {
		return option.isCreator
		? `Create \"${filterText}\"`
		: option.label;
	} } = $$props;

	let { optionIdentifier = "value" } = $$props;
	let { loadOptions = undefined } = $$props;
	let { hasError = false } = $$props;
	let { containerStyles = "" } = $$props;

	let { getSelectionLabel = option => {
		if (option) return option.label;
	} } = $$props;

	let { createGroupHeaderItem = groupValue => {
		return { value: groupValue, label: groupValue };
	} } = $$props;

	let { createItem = filterText => {
		return { value: filterText, label: filterText };
	} } = $$props;

	let { isSearchable = true } = $$props;
	let { inputStyles = "" } = $$props;
	let { isClearable = true } = $$props;
	let { isWaiting = false } = $$props;
	let { listPlacement = "auto" } = $$props;
	let { listOpen = false } = $$props;
	let { list = undefined } = $$props;
	let { isVirtualList = false } = $$props;
	let { loadOptionsInterval = 300 } = $$props;
	let { noOptionsMessage = "No options" } = $$props;
	let { hideEmptyState = false } = $$props;
	let { filteredItems = [] } = $$props;
	let { inputAttributes = {} } = $$props;
	let { listAutoWidth = true } = $$props;
	let { itemHeight = 40 } = $$props;
	let target;
	let activeSelectedValue;
	let originalItemsClone;
	let containerClasses = "";
	let prev_selectedValue;
	let prev_listOpen;
	let prev_filterText;
	let prev_isFocused;
	let prev_filteredItems;

	async function resetFilter() {
		await tick();
		filterText = "";
	}

	const getItems = debounce(
		async () => {
			isWaiting = true;
			items = await loadOptions(filterText);
			isWaiting = false;
			isFocused = true;
			listOpen = true;
		},
		loadOptionsInterval
	);

	let _inputAttributes = {};

	beforeUpdate(() => {
		if (isMulti && selectedValue && selectedValue.length > 1) {
			checkSelectedValueForDuplicates();
		}

		if (!isMulti && selectedValue && prev_selectedValue !== selectedValue) {
			if (!prev_selectedValue || JSON.stringify(selectedValue[optionIdentifier]) !== JSON.stringify(prev_selectedValue[optionIdentifier])) {
				dispatch("select", selectedValue);
			}
		}

		if (isMulti && JSON.stringify(selectedValue) !== JSON.stringify(prev_selectedValue)) {
			if (checkSelectedValueForDuplicates()) {
				dispatch("select", selectedValue);
			}
		}

		if (container && listOpen !== prev_listOpen) {
			if (listOpen) {
				loadList();
			} else {
				removeList();
			}
		}

		if (filterText !== prev_filterText) {
			if (filterText.length > 0) {
				isFocused = true;
				listOpen = true;

				if (loadOptions) {
					getItems();
				} else {
					loadList();
					listOpen = true;

					if (isMulti) {
						activeSelectedValue = undefined;
					}
				}
			} else {
				setList([]);
			}

			if (list) {
				list.$set({ filterText });
			}
		}

		if (isFocused !== prev_isFocused) {
			if (isFocused || listOpen) {
				handleFocus();
			} else {
				resetFilter();
				if (input) input.blur();
			}
		}

		if (prev_filteredItems !== filteredItems) {
			let _filteredItems = [...filteredItems];

			if (isCreatable && filterText) {
				const itemToCreate = createItem(filterText);
				itemToCreate.isCreator = true;

				const existingItemWithFilterValue = _filteredItems.find(item => {
					return item[optionIdentifier] === itemToCreate[optionIdentifier];
				});

				let existingSelectionWithFilterValue;

				if (selectedValue) {
					if (isMulti) {
						existingSelectionWithFilterValue = selectedValue.find(selection => {
							return selection[optionIdentifier] === itemToCreate[optionIdentifier];
						});
					} else if (selectedValue[optionIdentifier] === itemToCreate[optionIdentifier]) {
						existingSelectionWithFilterValue = selectedValue;
					}
				}

				if (!existingItemWithFilterValue && !existingSelectionWithFilterValue) {
					_filteredItems = [..._filteredItems, itemToCreate];
				}
			}

			setList(_filteredItems);
		}

		prev_selectedValue = selectedValue;
		prev_listOpen = listOpen;
		prev_filterText = filterText;
		prev_isFocused = isFocused;
		prev_filteredItems = filteredItems;
	});

	function checkSelectedValueForDuplicates() {
		let noDuplicates = true;

		if (selectedValue) {
			const ids = [];
			const uniqueValues = [];

			selectedValue.forEach(val => {
				if (!ids.includes(val[optionIdentifier])) {
					ids.push(val[optionIdentifier]);
					uniqueValues.push(val);
				} else {
					noDuplicates = false;
				}
			});

			selectedValue = uniqueValues;
		}

		return noDuplicates;
	}

	async function setList(items) {
		await tick();
		if (list) return list.$set({ items });
		if (loadOptions && items.length > 0) loadList();
	}

	async function getPosition() {
		await tick();
		if (!target || !container) return;
		const { top, height, width } = container.getBoundingClientRect();
		target.style["min-width"] = `${width}px`;
		target.style.width = `${listAutoWidth ? "auto" : "100%"}`;
		target.style.left = "0";

		if (listPlacement === "top") {
			target.style.bottom = `${height + 5}px`;
		} else {
			target.style.top = `${height + 5}px`;
		}

		target = target;

		if (listPlacement === "auto" && isOutOfViewport(target).bottom) {
			target.style.top = ``;
			target.style.bottom = `${height + 5}px`;
		}

		target.style.visibility = "";
	}

	function handleFocus() {
		isFocused = true;
		if (input) input.focus();
	}

	function removeList() {
		resetFilter();
		activeSelectedValue = undefined;
		if (!list) return;
		list.$destroy();
		list = undefined;
		if (!target) return;
		if (target.parentNode) target.parentNode.removeChild(target);
		target = undefined;
		list = list;
		target = target;
	}

	function handleClear() {
		selectedValue = undefined;
		listOpen = false;
		dispatch("clear", selectedValue);
		handleFocus();
	}

	async function loadList() {
		await tick();
		if (target && list) return;

		const data = {
			Item: Item$1,
			filterText,
			optionIdentifier,
			noOptionsMessage,
			hideEmptyState,
			isVirtualList,
			selectedValue,
			isMulti,
			getGroupHeaderLabel,
			items: filteredItems,
			itemHeight
		};

		if (getOptionLabel) {
			data.getOptionLabel = getOptionLabel;
		}

		target = document.createElement("div");

		Object.assign(target.style, {
			position: "absolute",
			"z-index": 2,
			"visibility": "hidden"
		});

		list = list;
		target = target;
		if (container) container.appendChild(target);
		list = new List({ target, props: data });

		list.$on("itemSelected", event => {
			const { detail } = event;

			if (detail) {
				const item = Object.assign({}, detail);

				if (isMulti) {
					selectedValue = selectedValue ? selectedValue.concat([item]) : [item];
				} else {
					selectedValue = item;
				}

				resetFilter();
				selectedValue = selectedValue;

				setTimeout(() => {
					listOpen = false;
					activeSelectedValue = undefined;
				});
			}
		});

		list.$on("itemCreated", event => {
			const { detail } = event;

			if (isMulti) {
				selectedValue = selectedValue || [];
				selectedValue = [...selectedValue, createItem(detail)];
			} else {
				selectedValue = createItem(detail);
			}

			filterText = "";
			listOpen = false;
			activeSelectedValue = undefined;
			resetFilter();
		});

		list.$on("closeList", () => {
			listOpen = false;
		});

		(list = list, target = target);
		getPosition();
	}

	onMount(() => {
		if (isFocused) input.focus();
		if (listOpen) loadList();

		if (items && items.length > 0) {
			originalItemsClone = JSON.stringify(items);
		}

		if (selectedValue) {
			if (isMulti) {
				selectedValue = selectedValue.map(item => {
					if (typeof item === "string") {
						return { value: item, label: item };
					} else {
						return item;
					}
				});
			}
		}
	});

	onDestroy(() => {
		removeList();
	});

	if ($$props.container === void 0 && $$bindings.container && container !== void 0) $$bindings.container(container);
	if ($$props.input === void 0 && $$bindings.input && input !== void 0) $$bindings.input(input);
	if ($$props.Item === void 0 && $$bindings.Item && Item$1 !== void 0) $$bindings.Item(Item$1);
	if ($$props.Selection === void 0 && $$bindings.Selection && Selection$1 !== void 0) $$bindings.Selection(Selection$1);
	if ($$props.MultiSelection === void 0 && $$bindings.MultiSelection && MultiSelection$1 !== void 0) $$bindings.MultiSelection(MultiSelection$1);
	if ($$props.isMulti === void 0 && $$bindings.isMulti && isMulti !== void 0) $$bindings.isMulti(isMulti);
	if ($$props.isDisabled === void 0 && $$bindings.isDisabled && isDisabled !== void 0) $$bindings.isDisabled(isDisabled);
	if ($$props.isCreatable === void 0 && $$bindings.isCreatable && isCreatable !== void 0) $$bindings.isCreatable(isCreatable);
	if ($$props.isFocused === void 0 && $$bindings.isFocused && isFocused !== void 0) $$bindings.isFocused(isFocused);
	if ($$props.selectedValue === void 0 && $$bindings.selectedValue && selectedValue !== void 0) $$bindings.selectedValue(selectedValue);
	if ($$props.filterText === void 0 && $$bindings.filterText && filterText !== void 0) $$bindings.filterText(filterText);
	if ($$props.placeholder === void 0 && $$bindings.placeholder && placeholder !== void 0) $$bindings.placeholder(placeholder);
	if ($$props.items === void 0 && $$bindings.items && items !== void 0) $$bindings.items(items);
	if ($$props.itemFilter === void 0 && $$bindings.itemFilter && itemFilter !== void 0) $$bindings.itemFilter(itemFilter);
	if ($$props.groupBy === void 0 && $$bindings.groupBy && groupBy !== void 0) $$bindings.groupBy(groupBy);
	if ($$props.groupFilter === void 0 && $$bindings.groupFilter && groupFilter !== void 0) $$bindings.groupFilter(groupFilter);
	if ($$props.isGroupHeaderSelectable === void 0 && $$bindings.isGroupHeaderSelectable && isGroupHeaderSelectable !== void 0) $$bindings.isGroupHeaderSelectable(isGroupHeaderSelectable);
	if ($$props.getGroupHeaderLabel === void 0 && $$bindings.getGroupHeaderLabel && getGroupHeaderLabel !== void 0) $$bindings.getGroupHeaderLabel(getGroupHeaderLabel);
	if ($$props.getOptionLabel === void 0 && $$bindings.getOptionLabel && getOptionLabel !== void 0) $$bindings.getOptionLabel(getOptionLabel);
	if ($$props.optionIdentifier === void 0 && $$bindings.optionIdentifier && optionIdentifier !== void 0) $$bindings.optionIdentifier(optionIdentifier);
	if ($$props.loadOptions === void 0 && $$bindings.loadOptions && loadOptions !== void 0) $$bindings.loadOptions(loadOptions);
	if ($$props.hasError === void 0 && $$bindings.hasError && hasError !== void 0) $$bindings.hasError(hasError);
	if ($$props.containerStyles === void 0 && $$bindings.containerStyles && containerStyles !== void 0) $$bindings.containerStyles(containerStyles);
	if ($$props.getSelectionLabel === void 0 && $$bindings.getSelectionLabel && getSelectionLabel !== void 0) $$bindings.getSelectionLabel(getSelectionLabel);
	if ($$props.createGroupHeaderItem === void 0 && $$bindings.createGroupHeaderItem && createGroupHeaderItem !== void 0) $$bindings.createGroupHeaderItem(createGroupHeaderItem);
	if ($$props.createItem === void 0 && $$bindings.createItem && createItem !== void 0) $$bindings.createItem(createItem);
	if ($$props.isSearchable === void 0 && $$bindings.isSearchable && isSearchable !== void 0) $$bindings.isSearchable(isSearchable);
	if ($$props.inputStyles === void 0 && $$bindings.inputStyles && inputStyles !== void 0) $$bindings.inputStyles(inputStyles);
	if ($$props.isClearable === void 0 && $$bindings.isClearable && isClearable !== void 0) $$bindings.isClearable(isClearable);
	if ($$props.isWaiting === void 0 && $$bindings.isWaiting && isWaiting !== void 0) $$bindings.isWaiting(isWaiting);
	if ($$props.listPlacement === void 0 && $$bindings.listPlacement && listPlacement !== void 0) $$bindings.listPlacement(listPlacement);
	if ($$props.listOpen === void 0 && $$bindings.listOpen && listOpen !== void 0) $$bindings.listOpen(listOpen);
	if ($$props.list === void 0 && $$bindings.list && list !== void 0) $$bindings.list(list);
	if ($$props.isVirtualList === void 0 && $$bindings.isVirtualList && isVirtualList !== void 0) $$bindings.isVirtualList(isVirtualList);
	if ($$props.loadOptionsInterval === void 0 && $$bindings.loadOptionsInterval && loadOptionsInterval !== void 0) $$bindings.loadOptionsInterval(loadOptionsInterval);
	if ($$props.noOptionsMessage === void 0 && $$bindings.noOptionsMessage && noOptionsMessage !== void 0) $$bindings.noOptionsMessage(noOptionsMessage);
	if ($$props.hideEmptyState === void 0 && $$bindings.hideEmptyState && hideEmptyState !== void 0) $$bindings.hideEmptyState(hideEmptyState);
	if ($$props.filteredItems === void 0 && $$bindings.filteredItems && filteredItems !== void 0) $$bindings.filteredItems(filteredItems);
	if ($$props.inputAttributes === void 0 && $$bindings.inputAttributes && inputAttributes !== void 0) $$bindings.inputAttributes(inputAttributes);
	if ($$props.listAutoWidth === void 0 && $$bindings.listAutoWidth && listAutoWidth !== void 0) $$bindings.listAutoWidth(listAutoWidth);
	if ($$props.itemHeight === void 0 && $$bindings.itemHeight && itemHeight !== void 0) $$bindings.itemHeight(itemHeight);
	if ($$props.handleClear === void 0 && $$bindings.handleClear && handleClear !== void 0) $$bindings.handleClear(handleClear);
	$$result.css.add(css$c);

	 {
		{
			containerClasses = `selectContainer`;
			containerClasses += isMulti ? " multiSelect" : "";
			containerClasses += isDisabled ? " disabled" : "";
			containerClasses += isFocused ? " focused" : "";
		}
	}

	 {
		{
			if (typeof selectedValue === "string") {
				selectedValue = {
					[optionIdentifier]: selectedValue,
					label: selectedValue
				};
			}
		}
	}

	let showSelectedItem = selectedValue && filterText.length === 0;
	let placeholderText = selectedValue ? "" : placeholder;

	 {
		{
			_inputAttributes = Object.assign(inputAttributes, {
				autocomplete: "off",
				autocorrect: "off",
				spellcheck: false
			});

			if (!isSearchable) {
				_inputAttributes.readonly = true;
			}
		}
	}

	 {
		{
			let _filteredItems;
			let _items = items;

			if (items && items.length > 0 && typeof items[0] !== "object") {
				_items = items.map((item, index) => {
					return { index, value: item, label: item };
				});
			}

			if (loadOptions && filterText.length === 0 && originalItemsClone) {
				_filteredItems = JSON.parse(originalItemsClone);
				_items = JSON.parse(originalItemsClone);
			} else {
				_filteredItems = loadOptions
				? filterText.length === 0 ? [] : _items
				: _items.filter(item => {
						let keepItem = true;

						if (isMulti && selectedValue) {
							keepItem = !selectedValue.find(value => {
								return value[optionIdentifier] === item[optionIdentifier];
							});
						}

						if (!keepItem) return false;
						if (filterText.length < 1) return true;
						return itemFilter(getOptionLabel(item, filterText), filterText, item);
					});
			}

			if (groupBy) {
				const groupValues = [];
				const groups = {};

				_filteredItems.forEach(item => {
					const groupValue = groupBy(item);

					if (!groupValues.includes(groupValue)) {
						groupValues.push(groupValue);
						groups[groupValue] = [];

						if (groupValue) {
							groups[groupValue].push(Object.assign(createGroupHeaderItem(groupValue, item), {
								id: groupValue,
								isGroupHeader: true,
								isSelectable: isGroupHeaderSelectable
							}));
						}
					}

					groups[groupValue].push(Object.assign({ isGroupItem: !!groupValue }, item));
				});

				const sortedGroupedItems = [];

				groupFilter(groupValues).forEach(groupValue => {
					sortedGroupedItems.push(...groups[groupValue]);
				});

				filteredItems = sortedGroupedItems;
			} else {
				filteredItems = _filteredItems;
			}
		}
	}

	return `

<div class="${escape(containerClasses) + " " + escape(hasError ? "hasError" : "") + " svelte-e3bo9s"}"${add_attribute("style", containerStyles, 0)}${add_attribute("this", container, 1)}>

  ${isMulti && selectedValue && selectedValue.length > 0
	? `${validate_component(MultiSelection$1 || missing_component, "svelte:component").$$render(
			$$result,
			{
				selectedValue,
				getSelectionLabel,
				activeSelectedValue,
				isDisabled
			},
			{},
			{}
		)}`
	: ``}


  ${isDisabled
	? `<input${spread(
			[
				_inputAttributes,
				{ placeholder: escape(placeholderText) },
				{ style: escape(inputStyles) },
				{ disabled: true }
			],
			"svelte-e3bo9s"
		)}${add_attribute("this", input, 1)}${add_attribute("value", filterText, 1)}>`
	: `<input${spread(
			[
				_inputAttributes,
				{ placeholder: escape(placeholderText) },
				{ style: escape(inputStyles) }
			],
			"svelte-e3bo9s"
		)}${add_attribute("this", input, 1)}${add_attribute("value", filterText, 1)}>`}

  ${!isMulti && showSelectedItem
	? `<div class="${"selectedItem svelte-e3bo9s"}">
    ${validate_component(Selection$1 || missing_component, "svelte:component").$$render($$result, { item: selectedValue, getSelectionLabel }, {}, {})}
  </div>`
	: ``}

  ${showSelectedItem && isClearable && !isDisabled && !isWaiting
	? `<div class="${"clearSelect svelte-e3bo9s"}">
    <svg width="${"100%"}" height="${"100%"}" viewBox="${"-2 -2 50 50"}" focusable="${"false"}" role="${"presentation"}" class="${"svelte-e3bo9s"}">
      <path fill="${"currentColor"}" d="${"M34.923,37.251L24,26.328L13.077,37.251L9.436,33.61l10.923-10.923L9.436,11.765l3.641-3.641L24,19.047L34.923,8.124 l3.641,3.641L27.641,22.688L38.564,33.61L34.923,37.251z"}"></path>
    </svg>
  </div>`
	: ``}

  ${!isSearchable && !isDisabled && !isWaiting && (showSelectedItem && !isClearable || !showSelectedItem)
	? `<div class="${"indicator svelte-e3bo9s"}">
    <svg width="${"100%"}" height="${"100%"}" viewBox="${"0 0 20 20"}" focusable="${"false"}" class="${"css-19bqh2r svelte-e3bo9s"}">
      <path d="${"M4.516 7.548c0.436-0.446 1.043-0.481 1.576 0l3.908 3.747 3.908-3.747c0.533-0.481 1.141-0.446 1.574 0 0.436 0.445 0.408 1.197 0 1.615-0.406 0.418-4.695 4.502-4.695 4.502-0.217 0.223-0.502 0.335-0.787 0.335s-0.57-0.112-0.789-0.335c0 0-4.287-4.084-4.695-4.502s-0.436-1.17 0-1.615z"}"></path>
    </svg>
  </div>`
	: ``}

  ${isWaiting
	? `<div class="${"spinner svelte-e3bo9s"}">
    <svg class="${"spinner_icon svelte-e3bo9s"}" viewBox="${"25 25 50 50"}">
      <circle class="${"spinner_path svelte-e3bo9s"}" cx="${"50"}" cy="${"50"}" r="${"20"}" fill="${"none"}" stroke="${"currentColor"}" stroke-width="${"5"}" stroke-miterlimit="${"10"}"></circle>
    </svg>
  </div>`
	: ``}
</div>`;
});

/* src/components/Select.svelte generated by Svelte v3.17.1 */

const Select_1 = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { options = [] } = $$props;
	let { placeholder = "Search..." } = $$props;
	let { selectedValue = undefined } = $$props;
	let { getOptionLabel = option => Object.values(option).join(" / ") } = $$props;
	if ($$props.options === void 0 && $$bindings.options && options !== void 0) $$bindings.options(options);
	if ($$props.placeholder === void 0 && $$bindings.placeholder && placeholder !== void 0) $$bindings.placeholder(placeholder);
	if ($$props.selectedValue === void 0 && $$bindings.selectedValue && selectedValue !== void 0) $$bindings.selectedValue(selectedValue);
	if ($$props.getOptionLabel === void 0 && $$bindings.getOptionLabel && getOptionLabel !== void 0) $$bindings.getOptionLabel(getOptionLabel);
	let $$settled;
	let $$rendered;

	do {
		$$settled = true;

		$$rendered = `${validate_component(Select, "Select").$$render(
			$$result,
			{
				getOptionLabel,
				placeholder,
				items: options,
				getSelectionLabel: getOptionLabel,
				selectedValue
			},
			{
				selectedValue: $$value => {
					selectedValue = $$value;
					$$settled = false;
				}
			},
			{}
		)}`;
	} while (!$$settled);

	return $$rendered;
});

/* src/components/Typography/Subtitle.svelte generated by Svelte v3.17.1 */

const css$d = {
	code: "h2.svelte-f45v0f{font-weight:400;font-size:1em;line-height:2em;letter-spacing:0.02em}@media(max-width: 550px){h2.svelte-f45v0f{font-size:0.75em}}",
	map: "{\"version\":3,\"file\":\"Subtitle.svelte\",\"sources\":[\"Subtitle.svelte\"],\"sourcesContent\":[\"<style>\\n  h2 {\\n    font-weight: 400;\\n    font-size: 1em;\\n    line-height: 2em;\\n    letter-spacing: 0.02em;\\n  }\\n\\n  @media (max-width: 550px) {\\n    h2 {\\n      font-size: 0.75em;\\n    }\\n  }\\n</style>\\n\\n<h2>\\n  <slot />\\n</h2>\\n\"],\"names\":[],\"mappings\":\"AACE,EAAE,cAAC,CAAC,AACF,WAAW,CAAE,GAAG,CAChB,SAAS,CAAE,GAAG,CACd,WAAW,CAAE,GAAG,CAChB,cAAc,CAAE,MAAM,AACxB,CAAC,AAED,MAAM,AAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AACzB,EAAE,cAAC,CAAC,AACF,SAAS,CAAE,MAAM,AACnB,CAAC,AACH,CAAC\"}"
};

const Subtitle = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	$$result.css.add(css$d);

	return `<h2 class="${"svelte-f45v0f"}">
  ${$$slots.default ? $$slots.default({}) : ``}
</h2>`;
});

/* src/routes/PickRelated.svelte generated by Svelte v3.17.1 */

const css$e = {
	code: ".pick-related.svelte-1i43uwy{padding-bottom:25vh}.dropdowns.svelte-1i43uwy{max-width:75ch;margin:auto}",
	map: "{\"version\":3,\"file\":\"PickRelated.svelte\",\"sources\":[\"PickRelated.svelte\"],\"sourcesContent\":[\"<script>\\n  import { fade, fly } from \\\"svelte/transition\\\";\\n  import { groupBy } from \\\"util/index.js\\\";\\n  import { ENVIRONMENTS } from \\\"stores/FormState.js\\\";\\n  import Table from \\\"components/Table.svelte\\\";\\n  import Select from \\\"components/Select.svelte\\\";\\n  import Header from \\\"components/Header.svelte\\\";\\n  import Button from \\\"components/Button.svelte\\\";\\n  import Title from \\\"components/Typography/Title.svelte\\\";\\n  import Subtitle from \\\"components/Typography/Subtitle.svelte\\\";\\n  import RightChevron from \\\"components/Icons/RightChevron.svelte\\\";\\n\\n  export let state = {};\\n  export let assets = [];\\n  export let selectedAssets = [];\\n  export let environment;\\n\\n  let selectedItems = {},\\n    selectedEnv = environment,\\n    prevAssets,\\n    prevEnvironment;\\n\\n  $: selectedCorrelationKey = selectedAssets.length\\n    ? selectedAssets[0].corrKey\\n    : undefined;\\n  $: groupedSelectedAssets = groupBy(selectedAssets, \\\"name\\\");\\n  $: groupedAssets = groupBy(\\n    assets.filter(({ corrKey }) => corrKey === selectedCorrelationKey) || [],\\n    \\\"name\\\"\\n  );\\n\\n  $: {\\n    if (prevAssets != selectedAssets) {\\n      Object.keys(groupedAssets).forEach(name => {\\n        selectedItems[name] = groupedSelectedAssets[name]\\n          ? groupedSelectedAssets[name][0]\\n          : undefined;\\n      });\\n      prevAssets = selectedAssets;\\n    }\\n    if (prevEnvironment != environment) {\\n      selectedEnv = environment;\\n      prevEnvironment = environment;\\n    }\\n  }\\n\\n  $: isNextDisabled = [...Object.values(selectedItems), selectedEnv].some(\\n    value => !value\\n  ); // at least one value unselected\\n\\n  function onNext() {\\n    state.setEnvironment(selectedEnv.label);\\n    state.setSelectedAssets(Object.values(selectedItems));\\n    state.nextStep();\\n  }\\n</script>\\n\\n<style>\\n  .pick-related {\\n    padding-bottom: 25vh;\\n  }\\n\\n  .dropdowns {\\n    max-width: 75ch;\\n    margin: auto;\\n  }\\n</style>\\n\\n<div class=\\\"pick-related\\\">\\n  <Header\\n    title=\\\"Please select related assets\\\"\\n    nextButtonText=\\\"Confirm\\\"\\n    disableNext={isNextDisabled}\\n    nextButtonTooltip={isNextDisabled ? 'Please make selections for the remaining name groups' : undefined}\\n    {onNext}\\n    {state} />\\n  <div class=\\\"dropdowns\\\">\\n    <Subtitle>Select environment</Subtitle>\\n    <Select\\n      options={ENVIRONMENTS.map(env => ({ label: env }))}\\n      placeholder=\\\"Select environment\\\"\\n      bind:selectedValue={selectedEnv}\\n      getOptionLabel={option => option.label} />\\n    {#each Object.entries(groupedAssets) as [name, assets]}\\n      <Subtitle>Select from {name}</Subtitle>\\n      <Select\\n        options={assets}\\n        placeholder=\\\"Search {name}...\\\"\\n        bind:selectedValue={selectedItems[name]}\\n        getOptionLabel={option => option.id} />\\n    {/each}\\n  </div>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AA0DE,aAAa,eAAC,CAAC,AACb,cAAc,CAAE,IAAI,AACtB,CAAC,AAED,UAAU,eAAC,CAAC,AACV,SAAS,CAAE,IAAI,CACf,MAAM,CAAE,IAAI,AACd,CAAC\"}"
};

const PickRelated = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { state = {} } = $$props;
	let { assets = [] } = $$props;
	let { selectedAssets = [] } = $$props;
	let { environment } = $$props;
	let selectedItems = {}, selectedEnv = environment, prevAssets, prevEnvironment;

	function onNext() {
		state.setEnvironment(selectedEnv.label);
		state.setSelectedAssets(Object.values(selectedItems));
		state.nextStep();
	}

	if ($$props.state === void 0 && $$bindings.state && state !== void 0) $$bindings.state(state);
	if ($$props.assets === void 0 && $$bindings.assets && assets !== void 0) $$bindings.assets(assets);
	if ($$props.selectedAssets === void 0 && $$bindings.selectedAssets && selectedAssets !== void 0) $$bindings.selectedAssets(selectedAssets);
	if ($$props.environment === void 0 && $$bindings.environment && environment !== void 0) $$bindings.environment(environment);
	$$result.css.add(css$e);
	let $$settled;
	let $$rendered;

	do {
		$$settled = true;

		let selectedCorrelationKey = selectedAssets.length
		? selectedAssets[0].corrKey
		: undefined;

		let groupedSelectedAssets = groupBy(selectedAssets, "name");
		let groupedAssets = groupBy(assets.filter(({ corrKey }) => corrKey === selectedCorrelationKey) || [], "name");

		 {
			{
				if (prevAssets != selectedAssets) {
					Object.keys(groupedAssets).forEach(name => {
						selectedItems[name] = groupedSelectedAssets[name]
						? groupedSelectedAssets[name][0]
						: undefined;
					});

					prevAssets = selectedAssets;
				}

				if (prevEnvironment != environment) {
					selectedEnv = environment;
					prevEnvironment = environment;
				}
			}
		}

		let isNextDisabled = [...Object.values(selectedItems), selectedEnv].some(value => !value);

		$$rendered = `<div class="${"pick-related svelte-1i43uwy"}">
  ${validate_component(Header, "Header").$$render(
			$$result,
			{
				title: "Please select related assets",
				nextButtonText: "Confirm",
				disableNext: isNextDisabled,
				nextButtonTooltip: isNextDisabled
				? "Please make selections for the remaining name groups"
				: undefined,
				onNext,
				state
			},
			{},
			{}
		)}
  <div class="${"dropdowns svelte-1i43uwy"}">
    ${validate_component(Subtitle, "Subtitle").$$render($$result, {}, {}, { default: () => `Select environment` })}
    ${validate_component(Select_1, "Select").$$render(
			$$result,
			{
				options: ENVIRONMENTS.map(env => ({ label: env })),
				placeholder: "Select environment",
				getOptionLabel: option => option.label,
				selectedValue: selectedEnv
			},
			{
				selectedValue: $$value => {
					selectedEnv = $$value;
					$$settled = false;
				}
			},
			{}
		)}
    ${each(Object.entries(groupedAssets), ([name, assets]) => `${validate_component(Subtitle, "Subtitle").$$render($$result, {}, {}, {
			default: () => `Select from ${escape(name)}`
		})}
      ${validate_component(Select_1, "Select").$$render(
			$$result,
			{
				options: assets,
				placeholder: "Search " + name + "...",
				getOptionLabel: option => option.id,
				selectedValue: selectedItems[name]
			},
			{
				selectedValue: $$value => {
					selectedItems[name] = $$value;
					$$settled = false;
				}
			},
			{}
		)}`)}
  </div>
</div>`;
	} while (!$$settled);

	return $$rendered;
});

/* src/routes/Confirm.svelte generated by Svelte v3.17.1 */

const css$f = {
	code: ".content.svelte-18grau8.svelte-18grau8{max-width:75ch;margin:auto}.buttons.svelte-18grau8.svelte-18grau8{display:flex;justify-content:center}.summary.svelte-18grau8.svelte-18grau8{display:flex;flex-flow:column;justify-content:center;padding:25px 0}.summary h2{font-weight:300}@media(min-width: 550px){.summary.svelte-18grau8.svelte-18grau8{margin-left:25%}}.buttons.svelte-18grau8 span.svelte-18grau8{margin-left:15px}span.cross.svelte-18grau8.svelte-18grau8{text-decoration:line-through}",
	map: "{\"version\":3,\"file\":\"Confirm.svelte\",\"sources\":[\"Confirm.svelte\"],\"sourcesContent\":[\"<script>\\n  import Header from \\\"components/Header.svelte\\\";\\n  import Button from \\\"components/Button.svelte\\\";\\n  import Subtitle from \\\"components/Typography/Subtitle.svelte\\\";\\n\\n  export let environment;\\n  export let selectedAssets = [];\\n  export let state = {};\\n  export let isSaving = false;\\n  export let onSubmit = () => {};\\n</script>\\n\\n<style>\\n  .content {\\n    max-width: 75ch;\\n    margin: auto;\\n  }\\n\\n  .buttons {\\n    display: flex;\\n    justify-content: center;\\n  }\\n\\n  .summary {\\n    display: flex;\\n    flex-flow: column;\\n    justify-content: center;\\n    padding: 25px 0;\\n  }\\n\\n  :global(.summary h2) {\\n    font-weight: 300;\\n  }\\n\\n  @media (min-width: 550px) {\\n    .summary {\\n      margin-left: 25%;\\n    }\\n  }\\n\\n  .buttons span {\\n    margin-left: 15px;\\n  }\\n\\n  span.cross {\\n    text-decoration: line-through;\\n  }\\n</style>\\n\\n<div class=\\\"confirm\\\">\\n  <Header title=\\\"Confirm your changes\\\" showNext={false} {state} />\\n  <div class=\\\"content\\\">\\n    <div class=\\\"summary\\\">\\n      {#each selectedAssets as { name, id, env }}\\n        <Subtitle>\\n          {name} {id}:\\n          <span class=\\\"cross\\\">{env}</span>\\n          {environment}\\n        </Subtitle>\\n      {/each}\\n    </div>\\n    <div class=\\\"buttons\\\">\\n      <span class=\\\"cancel\\\">\\n        <Button outline={true} onClick={() => state.reset()}>Cancel</Button>\\n      </span>\\n      <span class=\\\"submit\\\">\\n        <Button\\n          outline={true}\\n          onClick={() => onSubmit(environment, selectedAssets)}>\\n          {isSaving ? 'Saving...' : 'Submit'}\\n        </Button>\\n      </span>\\n    </div>\\n  </div>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAaE,QAAQ,8BAAC,CAAC,AACR,SAAS,CAAE,IAAI,CACf,MAAM,CAAE,IAAI,AACd,CAAC,AAED,QAAQ,8BAAC,CAAC,AACR,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,AACzB,CAAC,AAED,QAAQ,8BAAC,CAAC,AACR,OAAO,CAAE,IAAI,CACb,SAAS,CAAE,MAAM,CACjB,eAAe,CAAE,MAAM,CACvB,OAAO,CAAE,IAAI,CAAC,CAAC,AACjB,CAAC,AAEO,WAAW,AAAE,CAAC,AACpB,WAAW,CAAE,GAAG,AAClB,CAAC,AAED,MAAM,AAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AACzB,QAAQ,8BAAC,CAAC,AACR,WAAW,CAAE,GAAG,AAClB,CAAC,AACH,CAAC,AAED,uBAAQ,CAAC,IAAI,eAAC,CAAC,AACb,WAAW,CAAE,IAAI,AACnB,CAAC,AAED,IAAI,MAAM,8BAAC,CAAC,AACV,eAAe,CAAE,YAAY,AAC/B,CAAC\"}"
};

const Confirm = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { environment } = $$props;
	let { selectedAssets = [] } = $$props;
	let { state = {} } = $$props;
	let { isSaving = false } = $$props;

	let { onSubmit = () => {
		
	} } = $$props;

	if ($$props.environment === void 0 && $$bindings.environment && environment !== void 0) $$bindings.environment(environment);
	if ($$props.selectedAssets === void 0 && $$bindings.selectedAssets && selectedAssets !== void 0) $$bindings.selectedAssets(selectedAssets);
	if ($$props.state === void 0 && $$bindings.state && state !== void 0) $$bindings.state(state);
	if ($$props.isSaving === void 0 && $$bindings.isSaving && isSaving !== void 0) $$bindings.isSaving(isSaving);
	if ($$props.onSubmit === void 0 && $$bindings.onSubmit && onSubmit !== void 0) $$bindings.onSubmit(onSubmit);
	$$result.css.add(css$f);

	return `<div class="${"confirm"}">
  ${validate_component(Header, "Header").$$render(
		$$result,
		{
			title: "Confirm your changes",
			showNext: false,
			state
		},
		{},
		{}
	)}
  <div class="${"content svelte-18grau8"}">
    <div class="${"summary svelte-18grau8"}">
      ${each(selectedAssets, ({ name, id, env }) => `${validate_component(Subtitle, "Subtitle").$$render($$result, {}, {}, {
		default: () => `
          ${escape(name)} ${escape(id)}:
          <span class="${"cross svelte-18grau8"}">${escape(env)}</span>
          ${escape(environment)}
        `
	})}`)}
    </div>
    <div class="${"buttons svelte-18grau8"}">
      <span class="${"cancel svelte-18grau8"}">
        ${validate_component(Button, "Button").$$render(
		$$result,
		{
			outline: true,
			onClick: () => state.reset()
		},
		{},
		{ default: () => `Cancel` }
	)}
      </span>
      <span class="${"submit svelte-18grau8"}">
        ${validate_component(Button, "Button").$$render(
		$$result,
		{
			outline: true,
			onClick: () => onSubmit(environment, selectedAssets)
		},
		{},
		{
			default: () => `
          ${escape(isSaving ? "Saving..." : "Submit")}
        `
		}
	)}
      </span>
    </div>
  </div>
</div>`;
});

/* src/App.svelte generated by Svelte v3.17.1 */

const css$g = {
	code: "#app{overflow:hidden}#app.dark{width:100vw;height:100vh;background:#2d3436}.container.svelte-tffzhg{width:100vw;display:flex;transition:transform 500ms cubic-bezier(0.23, 1, 0.32, 1) 0s}.page.svelte-tffzhg{min-width:100vw;padding:0 20px}",
	map: "{\"version\":3,\"file\":\"App.svelte\",\"sources\":[\"App.svelte\"],\"sourcesContent\":[\"<script>\\n  import { onMount, onDestroy } from \\\"svelte\\\";\\n  import { NotificationDisplay, notifier } from \\\"@beyonk/svelte-notifications\\\";\\n  import { formState, FORM_STEPS } from \\\"stores/FormState.js\\\";\\n  import { capitalize } from \\\"util/index.js\\\";\\n  import Promote from \\\"routes/Promote.svelte\\\";\\n  import PickRelated from \\\"routes/PickRelated.svelte\\\";\\n  import Confirm from \\\"routes/Confirm.svelte\\\";\\n\\n  // Used for SSR. A falsy value is ignored by the Router.\\n  export let url = \\\"\\\";\\n\\n  let isLoading = false;\\n  let translateX = 0;\\n  const store = {\\n    assets: [],\\n    currentStep: 0,\\n    selectedAssets: [],\\n    environment: null\\n  };\\n\\n  onMount(() => {\\n    formState.subscribe((field, value) => {\\n      store[field] = value;\\n      if (field === \\\"currentStep\\\") {\\n        updateStep();\\n      }\\n    });\\n  });\\n\\n  onDestroy(() => formState.unsubscribe());\\n\\n  function updateStep() {\\n    translateX = -1 * store.currentStep * window.innerWidth;\\n  }\\n\\n  function postPromotedAssets(assets) {\\n    return new Promise(resolve => {\\n      setTimeout(() => resolve({ statusCode: 200 }), 1500);\\n    });\\n  }\\n\\n  async function onSubmit(environment, assets) {\\n    isLoading = true;\\n    const payload = assets.map(asset => ({ ...asset, env: environment }));\\n    // send mock call\\n    const response = await postPromotedAssets(payload);\\n    isLoading = false;\\n    if (response.statusCode === 200) {\\n      formState.setAssets(\\n        store.assets.map(asset =>\\n          assets.includes(asset) ? { ...asset, env: environment } : asset\\n        )\\n      );\\n      formState.reset();\\n      notifier.success(\\\"Promotion successful!\\\");\\n    }\\n  }\\n\\n  function formatTitle(title) {\\n    return capitalize(title.replace(\\\"-\\\", \\\" \\\"));\\n  }\\n</script>\\n\\n<style>\\n  :global(#app) {\\n    overflow: hidden;\\n  }\\n\\n  :global(#app.dark) {\\n    width: 100vw;\\n    height: 100vh;\\n    background: #2d3436;\\n  }\\n\\n  .container {\\n    width: 100vw;\\n    display: flex;\\n    transition: transform 500ms cubic-bezier(0.23, 1, 0.32, 1) 0s;\\n  }\\n\\n  .page {\\n    min-width: 100vw;\\n    padding: 0 20px;\\n  }\\n</style>\\n\\n<svelte:window on:resize={updateStep} />\\n\\n<svelte:head>\\n  <meta name=\\\"viewport\\\" content=\\\"width=device-width, initial-scale=1\\\" />\\n  <title>\\n    {`Step ${store.currentStep + 1}/${FORM_STEPS.length} ${formatTitle(FORM_STEPS[store.currentStep])} | Multi-Asset Promotion`}\\n  </title>\\n</svelte:head>\\n\\n<div class=\\\"container\\\" style={`transform: translate3d(${translateX}px, 0, 0);`}>\\n  <div class=\\\"page\\\">\\n    <Promote state={formState} assets={store.assets} />\\n  </div>\\n  <div class=\\\"page\\\">\\n    <PickRelated state={formState} {...store} />\\n  </div>\\n  <div class=\\\"page\\\">\\n    <Confirm state={formState} {...store} {onSubmit} isSaving={isLoading} />\\n  </div>\\n</div>\\n\\n<NotificationDisplay />\\n\"],\"names\":[],\"mappings\":\"AAiEU,IAAI,AAAE,CAAC,AACb,QAAQ,CAAE,MAAM,AAClB,CAAC,AAEO,SAAS,AAAE,CAAC,AAClB,KAAK,CAAE,KAAK,CACZ,MAAM,CAAE,KAAK,CACb,UAAU,CAAE,OAAO,AACrB,CAAC,AAED,UAAU,cAAC,CAAC,AACV,KAAK,CAAE,KAAK,CACZ,OAAO,CAAE,IAAI,CACb,UAAU,CAAE,SAAS,CAAC,KAAK,CAAC,aAAa,IAAI,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAAC,CAAC,CAAC,CAAC,EAAE,AAC/D,CAAC,AAED,KAAK,cAAC,CAAC,AACL,SAAS,CAAE,KAAK,CAChB,OAAO,CAAE,CAAC,CAAC,IAAI,AACjB,CAAC\"}"
};

function postPromotedAssets(assets) {
	return new Promise(resolve => {
			setTimeout(() => resolve({ statusCode: 200 }), 1500);
		});
}

function formatTitle(title) {
	return capitalize(title.replace("-", " "));
}

const App = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { url = "" } = $$props;
	let isLoading = false;
	let translateX = 0;

	const store = {
		assets: [],
		currentStep: 0,
		selectedAssets: [],
		environment: null
	};

	onMount(() => {
		formState.subscribe((field, value) => {
			store[field] = value;

			if (field === "currentStep") {
				updateStep();
			}
		});
	});

	onDestroy(() => formState.unsubscribe());

	function updateStep() {
		translateX = -1 * store.currentStep * window.innerWidth;
	}

	async function onSubmit(environment, assets) {
		isLoading = true;
		const payload = assets.map(asset => ({ ...asset, env: environment }));
		const response = await postPromotedAssets();
		isLoading = false;

		if (response.statusCode === 200) {
			formState.setAssets(store.assets.map(asset => assets.includes(asset)
			? { ...asset, env: environment }
			: asset));

			formState.reset();
			success("Promotion successful!");
		}
	}

	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);
	$$result.css.add(css$g);

	return `

${($$result.head += `<meta name="${"viewport"}" content="${"width=device-width, initial-scale=1"}">${($$result.title = `<title>
    ${escape(`Step ${store.currentStep + 1}/${FORM_STEPS.length} ${formatTitle(FORM_STEPS[store.currentStep])} | Multi-Asset Promotion`)}
  </title>`, "")}`, "")}

<div class="${"container svelte-tffzhg"}"${add_attribute("style", `transform: translate3d(${translateX}px, 0, 0);`, 0)}>
  <div class="${"page svelte-tffzhg"}">
    ${validate_component(Promote, "Promote").$$render($$result, { state: formState, assets: store.assets }, {}, {})}
  </div>
  <div class="${"page svelte-tffzhg"}">
    ${validate_component(PickRelated, "PickRelated").$$render($$result, Object.assign({ state: formState }, store), {}, {})}
  </div>
  <div class="${"page svelte-tffzhg"}">
    ${validate_component(Confirm, "Confirm").$$render($$result, Object.assign({ state: formState }, store, { onSubmit }, { isSaving: isLoading }), {}, {})}
  </div>
</div>

${validate_component(Notifications, "NotificationDisplay").$$render($$result, {}, {}, {})}`;
});

module.exports = App;
