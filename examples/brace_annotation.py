# A real Manim Community script, unchanged. Run it:   pymations run brace_annotation.py
# Share it:   pymations build brace_annotation.py -o brace_annotation.html

from manim import *

# Gallery-style: a segment between two dots, measured with braces above and below.


class BraceAnnotation(Scene):
    def construct(self):
        start = Dot([-2, -1, 0])
        end = Dot([2, 1, 0])
        line = Line([-2, -1, 0], [2, 1, 0], color=ORANGE)

        under = Brace(line)
        under_label = MathTex("x - x_1").next_to(under, DOWN)
        over = Brace(line, direction=UP)
        over_label = Text("slope", font_size=32).next_to(over, UP)

        self.play(FadeIn(start), FadeIn(end))
        self.play(Create(line))
        self.play(GrowFromCenter(under), Write(under_label))
        self.play(GrowFromCenter(over), Write(over_label))
        self.wait()
