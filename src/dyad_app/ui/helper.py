from collections.abc import Callable, Generator
from typing import Literal

import mesop as me


@me.component  # type: ignore
def icon_button(
    *,
    icon: str,
    tooltip: str,
    key: str = "",
    is_selected: bool = False,
    on_click: Callable[[me.ClickEvent], None] | None = None,
    background: str = me.theme_var("surface-container-low"),
    visibility: Literal["visible", "hidden"] = "visible",
):
    selected_style = me.Style(
        background=me.theme_var("surface-container-low"),
        color=me.theme_var("on-surface-variant"),
        visibility=visibility,
    )
    with me.tooltip(message=tooltip, show_delay_ms=300, key=key + "-tooltip"):
        with me.content_button(
            type="icon",
            key=key,
            on_click=on_click,
            style=selected_style
            if is_selected
            else me.Style(visibility=visibility),
        ):
            me.icon(icon)


def is_mobile():
    return me.viewport_size().width < _MOBILE_BREAKPOINT


_MOBILE_BREAKPOINT = 640


@me.component  # type: ignore
def menu_icon(
    *,
    icon: str,
    tooltip: str,
    key: str = "",
    on_click: Callable[[me.ClickEvent], None] | None = None,
):
    with me.tooltip(message=tooltip):
        with me.content_button(
            key=key,
            on_click=on_click,
            style=me.Style(margin=me.Margin.all(10)),
            type="icon",
        ):
            me.icon(icon)


@me.component  # type: ignore
def menu_item(
    *,
    icon: str,
    label: str,
    key: str = "",
    on_click: Callable[[me.ClickEvent], None | Generator[None, None, None]]
    | None = None,
):
    with me.box(on_click=on_click):
        with me.box(
            style=me.Style(
                background=me.theme_var("surface-container-high"),
                border_radius=20,
                cursor="pointer",
                display="inline-flex",
                gap=10,
                line_height=1,
                margin=me.Margin.all(10),
                padding=me.Padding(top=10, left=10, right=20, bottom=10),
            ),
        ):
            me.icon(icon)
            me.text(label, style=me.Style(height=24, line_height="24px"))
