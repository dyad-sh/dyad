import platform
from functools import partial

import mesop as me
import mesop.labs as mel
from dyad.settings.user_settings import (
    get_user_settings,
    toggle_sidebar_settings,
)

from dyad_app.ui.analytics_consent_dialog import (
    analytics_consent_dialog,
    show_analytics_consent,
)
from dyad_app.ui.header import header
from dyad_app.ui.helper import (
    menu_item,
)
from dyad_app.ui.history_pane import history_pane
from dyad_app.ui.pads_sidebar import pads_sidebar
from dyad_app.ui.state import (
    State,
    navigate_and_cancel_chat,
    new_chat,
)
from dyad_app.ui.status_bar import status_bar
from dyad_app.web_components.hover import hover
from dyad_app.web_components.keyboard_shortcuts import keyboard_shortcuts
from dyad_app.web_components.snackbar import snackbars


@me.stateclass
class ScaffoldState:
    show_sidebar_override: str
    keep_sidebar_override: bool
    hover_app_bar_button: bool


@me.content_component
def scaffold(*, page_title: str | None = None):
    show_analytics_consent()
    analytics_consent_dialog()
    keyboard_shortcuts()
    for snackbar in snackbars:
        if snackbar.is_visible:
            snackbar.render()
    with me.box(
        style=me.Style(
            background=me.theme_var("surface-container-low"),
            display="flex",
            flex_direction="column",
            height="100%",
            font_family="Geist",
        )
    ):
        with me.box(
            style=me.Style(
                display="flex",
                flex_direction="row",
                flex_grow=1,
                overflow="hidden",
            )
        ):
            app_bar()
            sidebar()

            with me.box(
                style=me.Style(
                    display="flex",
                    flex_direction="column",
                    flex_grow=1,
                    padding=me.Padding(right=12, bottom=4),
                )
            ):
                header(page_title=page_title)
                me.slot()
                status_bar()


def on_click_menu_icon(e: me.ClickEvent):
    """Expands and collapses sidebar menu."""
    toggle_sidebar_settings()


def app_bar():
    state = me.state(State)
    with me.box(
        style=me.Style(
            background=me.theme_var("surface-container"),
            display="flex",
            flex_direction="column",
            gap=16,
            width=68,
            max_width=68,
            min_width=68,
            padding=me.Padding.symmetric(horizontal=6),
        )
    ):
        with me.tooltip(
            message="Menu " + "⌘+B"
            if platform.system() == "Darwin"
            else "Ctrl+B"
        ):
            with me.content_button(
                on_click=on_click_menu_icon,
                style=me.Style(margin=me.Margin(top=12, left=12)),
                type="icon",
            ):
                me.icon("menu")
        app_bar_button(
            icon="chat", text="Chat", url="/", active=state.page == "chat"
        )

        app_bar_button(
            icon="description",
            text="Pads",
            url="/pads",
            active=state.page == "pads",
        )

        app_bar_button(
            icon="settings",
            text="Settings",
            url="/settings",
            active=state.page == "settings",
        )


def on_click_navigate(e: me.ClickEvent, url: str):
    yield from navigate_and_cancel_chat(url)


def app_bar_button(
    *,
    icon: str,
    text: str,
    url: str,
    active: bool = False,
):
    def on_mouseover(e: mel.WebEvent):
        s = me.state(ScaffoldState)
        s.show_sidebar_override = e.key
        s.keep_sidebar_override = True
        s.hover_app_bar_button = True

    def on_mouseout(e: mel.WebEvent):
        s = me.state(ScaffoldState)
        s.hover_app_bar_button = False
        if s.show_sidebar_override == e.key and not s.keep_sidebar_override:
            s.show_sidebar_override = ""

    with hover(on_mouseout=on_mouseout, on_mouseover=on_mouseover, key=url):
        with me.box(
            style=me.Style(
                cursor="pointer",
                display="flex",
                flex_direction="column",
                align_items="center",
            ),
            on_click=partial(on_click_navigate, url=url),
        ):
            with me.box(
                style=me.Style(
                    background=me.theme_var("surface-container-high")
                    if active
                    else None,
                    padding=me.Padding.symmetric(horizontal=12, vertical=6),
                    border_radius=16,
                ),
                classes="hover-surface-container-highest",
            ):
                me.icon(
                    icon,
                )
            me.text(
                text,
                style=me.Style(
                    font_size=13, font_weight=500, margin=me.Margin(top=4)
                ),
            )


def noop(e):
    pass


def sidebar():
    state = me.state(State)
    is_sidebar_expanded = get_user_settings().sidebar_expanded
    if me.state(ScaffoldState).show_sidebar_override:
        is_sidebar_expanded = True

    def on_mouseover(e: mel.WebEvent):
        s = me.state(ScaffoldState)
        s.keep_sidebar_override = True

    def on_mouseout(e: mel.WebEvent):
        s = me.state(ScaffoldState)
        if not s.hover_app_bar_button:
            s.keep_sidebar_override = False
            s.show_sidebar_override = ""

    with me.box(
        style=me.Style(
            background=me.theme_var("surface-container-low"),
            display="flex",
            flex_direction="column",
            flex_shrink=0,
            width=300 if is_sidebar_expanded else 12,
            border_radius="0 12px 12px 0",
            z_index=800,
            transition="width 0.3s ease",
        )
    ):
        with hover(
            on_mouseout=on_mouseout
            if me.state(ScaffoldState).show_sidebar_override
            else noop,
            on_mouseover=on_mouseover
            if me.state(ScaffoldState).show_sidebar_override
            else noop,
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    flex_direction="column",
                    height="100vh",
                    padding=me.Padding(top=48),  # space for logo
                )
            ):
                show_sidebar_override = me.state(
                    ScaffoldState
                ).show_sidebar_override
                if show_sidebar_override:
                    if show_sidebar_override == "/":
                        chat_sidebar()
                    elif show_sidebar_override == "/pads":
                        pads_sidebar()
                    elif show_sidebar_override == "/settings":
                        settings_sidebar()
                    return
                if is_sidebar_expanded:
                    if state.page == "chat":
                        chat_sidebar()
                    elif state.page == "settings":
                        settings_sidebar()
                    elif state.page == "pads":
                        pads_sidebar()


def settings_sidebar():
    from dyad_app.ui.settings_page import settings_menu

    settings_menu()


def chat_sidebar():
    menu_item(
        icon="add",
        label="New chat (n)",
        on_click=lambda e: new_chat(),
    )
    history_pane()
