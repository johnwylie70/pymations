# A real Manim Community script, unchanged. Run it:   pymations run moving_frame_box.py
# Share it:   pymations build moving_frame_box.py -o moving_frame_box.html

from manim import *

# Gallery-style: a product-rule formula, a highlight box that slides from term to term.


class MovingFrameBox(Scene):
    def construct(self):
        formula = MathTex(
            r"\frac{d}{dx}f(x)g(x)", "=", r"f(x)\frac{d}{dx}g(x)", "+", r"g(x)\frac{d}{dx}f(x)"
        )
        self.play(Write(formula))

        box1 = SurroundingRectangle(formula[2], buff=0.1)
        box2 = SurroundingRectangle(formula[4], buff=0.1)
        self.play(Create(box1))
        self.wait()
        self.play(ReplacementTransform(box1, box2))
        self.wait()
        self.play(Indicate(formula[0]))
        self.play(FadeOut(box2))
        self.wait()
