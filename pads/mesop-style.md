---
title: Mesop Style rules
---

Mesop Style API Documentation

# IMPORTANT:

- padding must ALWAYS use `me.Padding`, for example, `me.Padding.all(16)` or `me.Padding(top=16)`, do not just use a raw integer. SAME THING WITH MARGIN.

---

This document provides a comprehensive overview of the Mesop Python API for styling UI components. The API wraps the browser's native CSS style API, allowing you to define and apply styles to your UI components using a Pythonic interface.

Style Dataclass

The Style dataclass represents the style configuration for a UI component. It contains a variety of attributes corresponding to CSS properties, enabling you to control various visual aspects of your components.

Attributes:

Attribute Description Type
align_content Aligns the flexible container's items on the cross-axis. See MDN for details. `ContentAlignmentValues
align_items	Specifies the default alignment for items inside a flexible container. See MDN for details.	`ItemAlignmentValues
align_self Overrides a grid or flex item's align-items value. In Grid, it aligns the item inside the grid area. In Flexbox, it aligns the item on the cross axis. See MDN for details. `ItemAlignmentValues
aspect_ratio	Specifies the desired width-to-height ratio of a component. See MDN for details.	`str
background Sets the background color or image of the component. See MDN for details. `str
border	Defines the border properties for each side of the component. See MDN for details.	`Border
border_radius Defines the border radius. See MDN for details. `int
bottom	Helps set vertical position of a positioned element. See MDN for details.	`int
box_shadow Defines the box shadow. See MDN for details. `str
box_sizing	Defines the box sizing. See MDN for details.	`str
color Sets the color of the text inside the component. See MDN for details. `str
column_gap	Sets the gap between columns. See MDN for details.	`int
columns Specifies the number of columns in a multi-column element. See MDN for details. `int
cursor	Sets the mouse cursor. See MDN for details.	`str
display Defines the display type of the component. See MDN for details. `Literal['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'none', 'contents']
flex_basis	Specifies the initial length of a flexible item. See MDN for details.	`str
flex_direction Establishes the main-axis, thus defining the direction flex items are placed in the flex container. See MDN for details. `Literal['row', 'row-reverse', 'column', 'column-reverse']
flex_grow	Defines the ability for a flex item to grow if necessary. See MDN for details.	`int
flex_shrink Defines the ability for a flex item to shrink if necessary. See MDN for details. `int
flex_wrap	Allows flex items to wrap onto multiple lines. See MDN for details.	`Literal['nowrap', 'wrap', 'wrap-reverse']
font_family Specifies the font family. See MDN for details. `str
font_size	Sets the size of the font. See MDN for details.	`int
font_style Specifies the font style for text. See MDN for details. `Literal['italic', 'normal']
font_weight	Sets the weight (or boldness) of the font. See MDN for details.	`Literal['bold', 'normal', 100, 200, 300, 400, 500, 600, 700, 800, 900]
gap Sets the gap. See MDN for details. `int
grid_area	Sets the grid area. See MDN for details.	`str
grid_auto_columns CSS property specifies the size of an implicitly-created grid column track or pattern of tracks. See MDN for details. `str
grid_auto_flow	CSS property controls how the auto-placement algorithm works, specifying exactly how auto-placed items get flowed into the grid. See MDN for details.	`str
grid_auto_rows CSS property specifies the size of an implicitly-created grid row track or pattern of tracks. See MDN for details. `str
grid_column	CSS shorthand property specifies a grid item's size and location within a grid column. See MDN for details.	`str
grid_column_start Sets the grid column start. See MDN for details. `int
grid_column_end	Sets the grid column end. See MDN for details.	`int
grid_row CSS shorthand property specifies a grid item's size and location within a grid row. See MDN for details. `str
grid_row_start	Sets the grid row start. See MDN for details.	`int
grid_row_end Sets the grid row end. See MDN for details. `int
grid_template_areas	Sets the grid template areas; each element is a row. See MDN for details.	`list[str]
grid_template_columns Sets the grid template columns. See MDN for details. `str
grid_template_rows	Sets the grid template rows. See MDN for details.	`str
height Sets the height of the component. See MDN for details. `int
justify_content	Aligns the flexible container's items on the main-axis. See MDN for details.	`ContentAlignmentValues
justify_items Defines the default justify-self for all items of the box, giving them all a default way of justifying each box along the appropriate axis. See MDN for details. `ItemJustifyValues
justify_self	Sets the way a box is justified inside its alignment container along the appropriate axis. See MDN for details.	`ItemJustifyValues
left Helps set horizontal position of a positioned element. See MDN for details. `int
letter_spacing	Increases or decreases the space between characters in text. See MDN for details.	`int
line Set the line height (relative to the font size). See MDN for details. height
margin Sets the margin space required on each side of an element. See MDN for details. `Margin
max_height	Sets the maximum height of an element. See MDN for details.	`int
max_width Sets the maximum width of an element. See MDN for details. `int
min_height	Sets the minimum height of an element. See MDN for details.	`int
min_width Sets the minimum width of an element. See MDN for details. `int
opacity	Sets the opacity property. See MDN for details.	`float
outline Sets the outline property. Note: input component has default browser stylings. See MDN for details. `str
overflow_wrap	Specifies how long text can be broken up by new lines to prevent overflowing. See MDN for details.	`OverflowWrapValues
overflow_x Specifies the handling of overflow in the horizontal direction. See MDN for details. `OverflowValues
overflow_y	Specifies the handling of overflow in the vertical direction. See MDN for details.	`OverflowValues
padding Sets the padding space required on each side of an element. See MDN for details. `Padding
place_items	The CSS place-items shorthand property allows you to align items along both the block and inline directions at once. See MDN for details.	`str
pointer_events Sets under what circumstances (if any) a particular graphic element can become the target of pointer events. See MDN for details. `PointerEventsValues
position	Specifies the type of positioning method used for an element (static, relative, absolute, fixed, or sticky). See MDN for details.	`Literal['static', 'relative', 'absolute', 'fixed', 'sticky']
right Helps set horizontal position of a positioned element. See MDN for details. `int
rotate	Allows you to specify rotation transforms individually and independently of the transform property. See MDN for details.	`str
row_gap Sets the gap between rows. See MDN for details. `int
text_align	Specifies the horizontal alignment of text in an element. See MDN for details.	`Literal['start', 'end', 'left', 'right', 'center']
text_decoration Specifies the decoration added to text. See MDN for details. `Literal['underline', 'none']
text_overflow	Specifies how overflowed content that is not displayed should be signaled to the user. See MDN for details.	`Literal['ellipsis', 'clip']
top Helps set vertical position of a positioned element. See MDN for details. `int
transform	Lets you rotate, scale, skew, or translate an element. It modifies the coordinate space of the CSS visual formatting model. See MDN for details.	`str
visibility Sets the visibility property. See MDN for details. `Literal['visible', 'hidden', 'collapse', 'inherit', 'initial', 'revert', 'revert-layer', 'unset']
white_space	Specifies how white space inside an element is handled. See MDN for details.	`Literal['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces']
width Sets the width of the component. See MDN for details. `int
z_index	Sets the z-index of the component. See MDN for details.	`int
Border Dataclass

The Border dataclass defines the border styles for each side of a UI component. It allows you to customize the appearance of borders by specifying their width, color, and style.

Attributes:

Attribute Description Type
top Style for the top border. `BorderSide
right	Style for the right border.	`BorderSide
bottom Style for the bottom border. `BorderSide
left	Style for the left border.	`BorderSide

Methods:

all(value: BorderSide): Creates a Border instance with all sides having the same style.

symmetric(vertical: BorderSide | None = None, horizontal: BorderSide | None = None): Creates a Border instance with symmetric styles for vertical and horizontal sides.

BorderSide Dataclass

The BorderSide dataclass represents the style of a single side of a border in a UI component. It allows you to define the width, color, and style of a border side.

Attributes:

Attribute Description Type
width The width of the border. Can be specified as an integer value representing pixels, a string with a unit (e.g., '2em'), or None for no width. `int
color	The color of the border, represented as a string. This can be any valid CSS color value, or None for no color.	`str
style The style of the border. See MDN for details. `Literal['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset', 'hidden']
Margin Dataclass

The Margin dataclass defines the margin space around a UI component. It allows you to control the spacing between a component and its neighboring elements.

Attributes:

Attribute Description Type
top Top margin (note: 2 is the same as 2px). `int
right	Right margin.	`int
bottom Bottom margin. `int
left	Left margin.	`int

Methods:

all(value: int | str): Creates a Margin instance with the same value for all sides.

symmetric(vertical: int | str | None = None, horizontal: int | str | None = None): Creates a Margin instance with symmetric values for vertical and horizontal sides.

Padding Dataclass

The Padding dataclass defines the padding space around a UI component. It controls the spacing between a component's content and its border.

Attributes:

Attribute Description Type
top Top padding (note: 2 is the same as 2px). `int
right	Right padding.	`int
bottom Bottom padding. `int
left	Left padding.	`int

Methods:

all(value: int | str): Creates a Padding instance with the same value for all sides.

symmetric(vertical: int | str | None = None, horizontal: int | str | None = None): Creates a Padding instance with symmetric values for vertical and horizontal sides.

This documentation provides a comprehensive overview of the Mesop Python API for styling UI components. By utilizing this API, developers can create visually appealing and customized UIs with ease.
