import {
	GROUPKEY_ATT,
	CONTAINER_CLASSNAME,
	TRANSITION_NAME,
	TRANSITION,
	TRANSITION_END,
	TRANSFORM,
} from "./consts";
import { window, document } from "./browser";
import {
	$,
	getStyle,
	addOnceEvent,
	assign,
	getOffsetSize,
	getClientWidth,
	getClientHeight,
	getRectSize,
} from "./utils";
import {
	RectType, IPosition, IJQuery,
	IInfiniteGridItem, IDOMRendererStatus,
	IDOMRendererSize, IDOMRendererOptions,
	IDOMRendererOrgStyle,
} from "./types";

function removeTransition(style: HTMLElement["style"]) {
	style[`${TRANSITION}-property`] = "";
	style[`${TRANSITION}-duration`] = "";
	style[TRANSFORM] = "";
}
function setTransition(style: HTMLElement["style"], transitionDuration: number, pos1: IPosition, pos2: IPosition) {
	if (!transitionDuration) {
		removeTransition(style);
		return false;
	}
	if (pos1.left === pos2.left && pos1.top === pos2.top) {
		return false;
	}
	style[`${TRANSITION}-property`] = `${TRANSFORM},width,height`;
	style[`${TRANSITION}-duration`] = `${transitionDuration}s`;
	style[TRANSFORM] = `translate(${pos1.left - pos2.left}px,${pos1.top - pos2.top}px)`;
	return true;
}

function createContainer(element: HTMLElement) {
	const selectContainer = element.querySelector<HTMLElement>(`.${CONTAINER_CLASSNAME}`);

	if (selectContainer) {
		selectContainer.style.position = "relative";
		selectContainer.style.height = "100%";

		return selectContainer;
	}
	const container = document.createElement("div");

	container.className = CONTAINER_CLASSNAME;
	container.style.position = "relative";
	container.style.height = "100%";

	const children = element.children;
	const length = children.length;	// for IE8

	for (let i = 0; i < length; i++) {
		container.appendChild(children[0]);
	}
	element.appendChild(container);
	return container;
}

export default class DOMRenderer {
	public static removeItems(items: IInfiniteGridItem[]) {
		items.forEach(item => {
			if (item.el) {
				DOMRenderer.removeElement(item.el);
				item.el = null;
			}
		});
	}
	public static removeElement(element: HTMLElement) {
		const parentNode = element && element.parentNode;

		if (!parentNode) {
			return;
		}
		parentNode.removeChild(element);
	}
	public static createElements(items: IInfiniteGridItem[]) {
		if (!items.length) {
			return;
		}
		const noElementItems = items.filter(item => !item.el);

		if (!noElementItems.length) {
			return;
		}
		const elements = $(
			noElementItems.map(({ content }) => content.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, "")).join(""),
			true,
		);

		noElementItems.forEach((item, index) => {
			item.el = elements[index];
		});
	}
	public container: HTMLElement;
	public view: Window | HTMLElement;
	public options: IDOMRendererOptions = {
		useOffset: false,
		isEqualSize: false,
		isConstantSize: false,
		horizontal: false,
		container: false,
		percentage: false,
	};
	public _size: IDOMRendererSize = {
		container: -1,
		view: -1,
		viewport: -1,
		item: null,
	};
	public _orgStyle: IDOMRendererOrgStyle = {};
	private _isSizePercentage: boolean = false;
	private _isPosPercentage: boolean = false;
	constructor(element: string | HTMLElement | IJQuery, options: IDOMRendererOptions) {
		assign(this.options, options);
		this._init(element);
		this.resize();
	}
	public getStatus() {
		return {
			cssText: this.container.style.cssText,
			_size: assign({}, this._size),
		};
	}
	public setStatus(status: IDOMRendererStatus) {
		this.container.style.cssText = status.cssText;
		assign(this._size, status._size);
	}
	public updateSize(items: IInfiniteGridItem[]) {
		const { isEqualSize, isConstantSize, useOffset } = this.options;
		const size = this._size;

		return items.map(item => {
			if (!item.el) {
				return item;
			}
			if (isEqualSize && !size.item) {
				size.item = useOffset ? getOffsetSize(item.el) : getRectSize(item.el);
			}
			item.size = (isEqualSize && assign({}, size.item)) ||
				(isConstantSize && item.orgSize && item.orgSize.width && assign({}, item.orgSize)) ||
				(useOffset ? getOffsetSize(item.el) : getRectSize(item.el));
			if (!item.orgSize || !item.orgSize.width || !item.orgSize.height) {
				item.orgSize = assign({}, item.size);
			}
			return item;
		});
	}
	public createAndInsert(items: IInfiniteGridItem[], isAppend?: boolean) {
		DOMRenderer.createElements(items);

		this.renderItems(items);
		this._insert(items, isAppend);
	}
	public renderItems(items: IInfiniteGridItem[], transitionDuration?: number) {
		items.forEach(item => {
			this.renderItem(item, item.rect, transitionDuration);
		});
	}
	public renderItem(item: IInfiniteGridItem, rect: IInfiniteGridItem["rect"], transitionDuration?: number) {
		if (!item.el) {
			return;
		}
		const { el, prevRect } = item;
		const style = el.style;

		el.setAttribute(GROUPKEY_ATT, `${item.groupKey}`);
		style.position = "absolute";
		this._render(["width", "height"], rect, style);
		if (transitionDuration && TRANSITION && prevRect) {
			setTransition(style, transitionDuration, rect, prevRect);
			if ((el as any)[TRANSITION_NAME]) {
				return;
			}
			el[TRANSITION_NAME] = true;
			addOnceEvent(el, TRANSITION_END, () => {
				const itemRect = item.rect;

				removeTransition(style);
				this._render(["left", "top"], itemRect, style);
				item.prevRect = itemRect;
				el[TRANSITION_NAME] = false;
			});
		} else {
			this._render(["left", "top"], rect, style);
			item.prevRect = rect;
		}
	}
	public getViewSize() {
		return this._size.view;
	}
	public getViewportSize() {
		return this._size.viewport;
	}
	public getContainerSize() {
		return this._size.container;
	}
	public setContainerSize(size: number) {
		this._size.container = size;
		this.container.style[this.options.horizontal ? "width" : "height"] = `${size}px`;
	}
	public resize() {
		const horizontal = this.options.horizontal;
		const view = this.view;
		const size = this._calcSize();

		if (size === 0) {
			return;
		}
		const isResize = size !== this._size.viewport;

		if (isResize) {
			this._size = {
				view: -1,
				container: -1,
				viewport: size,
				item: null,
			};
		}
		this._size.view = horizontal ? getClientWidth(view) : getClientHeight(view);
		return isResize;
	}
	public isNeededResize() {
		return this._calcSize() !== this._size.viewport;
	}
	public clear() {
		this.container.innerHTML = "";
		this.container.style[this.options.horizontal ? "width" : "height"] = "";

		this._size = {
			item: null,
			viewport: -1,
			container: -1,
			view: -1,
		};
	}
	public destroy() {
		this.clear();
		const container = this.options.container;
		let property: keyof IDOMRendererOrgStyle;

		for (property in this._orgStyle) {
			(this[container ? "view" : "container"] as HTMLElement).style[property] = this._orgStyle[property]!;
		}
		if (container === true) {
			this.container.parentNode!.removeChild(this.container);
		}
	}
	private _init(el: HTMLElement | IJQuery | string) {
		const element = $(el);
		const style = getStyle(element);
		const { container, horizontal, percentage } = this.options;

		if (percentage) {
			this._isSizePercentage = percentage === true || percentage.indexOf("size") > -1;
			this._isPosPercentage = percentage === true || percentage.indexOf("position") > -1;
		}

		if (style.position === "static") {
			this._orgStyle.position = element.style.position;
			element.style.position = "relative";
		}
		if (container) {
			const target = horizontal ? ["X", "Y"] : ["Y", "X"];

			this._orgStyle.overflowX = element.style.overflowX;
			this._orgStyle.overflowY = element.style.overflowY;
			element.style[`overflow${target[0]}` as "overflowX" | "overflowY"] = "scroll";
			element.style[`overflow${target[1]}` as "overflowX" | "overflowY"] = "hidden";
			this.view = element;
			this.container = container === true ? createContainer(this.view as HTMLElement) : container;
		} else {
			this.view = window;
			this.container = element;
		}
	}
	private _insert(items: IInfiniteGridItem[], isAppend?: boolean, style?: IInfiniteGridItem["rect"]) {
		const container = this.container;
		const df = document.createDocumentFragment();

		items.forEach(item => {
			style && this.renderItem(item, style);
			isAppend ? df.appendChild(item.el!) : df.insertBefore(item.el!, df.firstChild);
		});
		isAppend ?
			container.appendChild(df) :
			container.insertBefore(df, container.firstChild);
	}
	private _calcSize() {
		return this.options.horizontal ?
			getClientHeight(this.container) : getClientWidth(this.container);
	}
	private _render(properties: RectType[], rect: IInfiniteGridItem["rect"], style: HTMLElement["style"]) {
		const isSizePercentage = this._isSizePercentage;
		const isPosPercentage = this._isPosPercentage;
		const viewportSize = this.getViewportSize();
		const horizontal = this.options.horizontal;

		properties.forEach(p => {
			if (!(p in rect)) {
				return;
			}
			const isHorizontalPercentage
				= horizontal && ((isSizePercentage && p === "height") || (isPosPercentage && p === "top"));
			const isVerticalPercentage
				= !horizontal && ((isSizePercentage && p === "width") || (isPosPercentage && p === "left"));

			style[p] = isHorizontalPercentage || isVerticalPercentage
				? `${rect[p]! / viewportSize * 100}%`
				: `${rect[p]}px`;
		});
	}
}
