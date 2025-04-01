import mesop as me

from dyad_app.ui.page_utils import SECURITY_POLICY, STYLESHEETS
from dyad_app.ui.provider_setup_dialog import provider_setup_dialog
from dyad_app.ui.scaffold import scaffold
from dyad_app.ui.settings.advanced import advanced_settings
from dyad_app.ui.settings.extensions import extensions_settings
from dyad_app.ui.settings.general import general_settings
from dyad_app.ui.settings.indexing import indexing_settings
from dyad_app.ui.settings.llm_logs import llm_logs_settings
from dyad_app.ui.settings.logs import logs_settings
from dyad_app.ui.settings.models import models_and_providers_settings
from dyad_app.ui.state import State
from dyad_app.ui.theme_utils import load_theme_mode_from_settings

SETTINGS_PANE_QUERY_PARAM = "settings-pane"


def get_settings_pane():
    if SETTINGS_PANE_QUERY_PARAM not in me.query_params:
        return "General"
    return me.query_params[SETTINGS_PANE_QUERY_PARAM]


def on_load(e: me.LoadEvent):
    state = me.state(State)
    state.page = "settings"
    load_theme_mode_from_settings()
    if SETTINGS_PANE_QUERY_PARAM not in me.query_params:
        me.query_params[SETTINGS_PANE_QUERY_PARAM] = "General"


@me.page(
    security_policy=SECURITY_POLICY,
    stylesheets=STYLESHEETS,
    title="Dyad",
    path="/settings",
    on_load=on_load,
)
def page():
    provider_setup_dialog()
    with scaffold(page_title="Settings"):
        body()


def body():
    with me.box(
        style=me.Style(
            padding=me.Padding.symmetric(vertical=16),
            border_radius=16,
            background=me.theme_var("surface-container-lowest"),
            flex_grow=1,
            display="flex",
            flex_direction="column",
            overflow="hidden",
        )
    ):
        settings_body()


def settings_menu():
    def click_menu_item(e: me.ClickEvent):
        me.navigate("/settings")
        me.query_params[SETTINGS_PANE_QUERY_PARAM] = e.key

    with me.box(
        style=me.Style(
            padding=me.Padding.all(12),
            display="flex",
            flex_direction="column",
            gap=8,
        )
    ):
        for group_name, group_items in [
            (
                "User",
                ["General", "Models & Providers", "Extensions", "Advanced"],
            ),
            (
                "Workspace",
                [
                    "Indexing",
                    "Prompt",
                    "Logs",
                    "LLM Calls",
                ],
            ),
        ]:
            me.text(
                group_name,
                style=me.Style(
                    font_size=16,
                    font_weight=500,
                    margin=me.Margin(top=16, bottom=4, left=8),
                ),
            )
            for name in group_items:
                with me.box(
                    classes="hover-surface-container-high",
                    style=me.Style(
                        margin=me.Margin(left=16),
                        padding=me.Padding.all(12),
                        border_radius=16,
                        cursor="pointer",
                        background=me.theme_var("surface-container-highest")
                        if get_settings_pane() == name
                        else None,
                    ),
                    on_click=click_menu_item,
                    key=name,
                ):
                    me.text(name)


def settings_body():
    active_pane = get_settings_pane()

    with me.box(
        style=me.Style(
            display="flex",
            flex_direction="column",
            gap=16,
            width="100%",
            flex_grow=1,
            overflow="auto" if active_pane != "LLM Calls" else None,
            padding=me.Padding.symmetric(horizontal=24),
        )
    ):
        me.text(
            active_pane,
            style=me.Style(font_size=24, margin=me.Margin(top=16)),
        )
        if active_pane == "General":
            general_settings()
        elif active_pane == "Models & Providers":
            models_and_providers_settings()
        elif active_pane == "Logs":
            logs_settings()
        elif active_pane == "LLM Calls":
            llm_logs_settings()
        elif active_pane == "Advanced":
            advanced_settings()
        elif active_pane == "Extensions":
            extensions_settings()
        elif active_pane == "Indexing":
            indexing_settings()
