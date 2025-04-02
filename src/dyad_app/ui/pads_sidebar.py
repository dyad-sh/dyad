from functools import partial

import mesop as me
from dyad.pad import Pad
from dyad.storage.models.pad import get_pad, get_pads

from dyad_app.ui.chat.pad_helpers import generate_id
from dyad_app.ui.helper import menu_item
from dyad_app.ui.side_pane_state import set_side_pane
from dyad_app.ui.state import State, navigate_and_cancel_chat


def new_pad(e):
    state = me.state(State)
    state.pad = Pad(
        id=generate_id(),
        title="Edit pad title",
        content="",
        complete=True,
        type="text/markdown",
    )
    set_side_pane("pad")
    yield from navigate_and_cancel_chat("/pads")


def pads_sidebar():
    with me.box(
        style=me.Style(
            display="flex",
            flex_direction="column",
            gap=2,
            overflow="auto",
            margin=me.Margin.all(12),
        )
    ):
        menu_item(
            icon="add",
            label="New pad",
            on_click=new_pad,
        )
        me.text("Pads", style=me.Style(font_size=16, font_weight="bold"))
        for pad in get_pads():
            pad_box(pad)


def pad_box(pad: Pad):
    assert pad.id is not None
    with me.box(
        style=me.Style(
            padding=me.Padding.all(8),
            border_radius=16,
            width="100%",
            overflow="hidden",
            cursor="pointer",
        ),
        classes="hover-surface-container-high",
        on_click=partial(click_pad, pad_id=pad.id),
    ):
        me.text(pad.title)


def click_pad(e: me.ClickEvent, pad_id: str):
    state = me.state(State)
    state.pad = get_pad(pad_id)
    set_side_pane("pad")
    yield from navigate_and_cancel_chat("/pads")
