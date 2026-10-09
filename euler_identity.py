# A real Manim Community script, unchanged. Run it:   pymations run euler_identity.py
# Share it:   pymations build euler_identity.py -o euler_identity.html

from manim import *

# Explainer: e^{i theta} walks round the unit circle; half a turn lands on -1, giving Euler's identity.

CIRCLE_COL, WALK_COL, RE_COL, IM_COL = BLUE, YELLOW, TEAL, ORANGE


def plane():
    p = NumberPlane(x_range=[-3, 3, 1], y_range=[-2, 2, 1], x_length=8.1, y_length=5.4)
    return p.shift(LEFT * 2.6 + DOWN * 0.5)


class Walk(Scene):
    def construct(self):
        title = Text("Euler's identity", font_size=40).to_edge(UP)
        self.play(Write(title))
        p = plane()
        self.play(Create(p), run_time=1.5)
        circle = Circle(radius=1.35, color=CIRCLE_COL).move_to(p.c2p(0, 0))
        one = MathTex("1", font_size=32).next_to(p.c2p(1, 0), DR, buff=0.1)
        i = MathTex("i", font_size=32).next_to(p.c2p(0, 1), UR, buff=0.1)
        self.play(Create(circle), Write(one), Write(i))

        formula = MathTex(r"e^{i\theta}", "=", r"\cos\theta", "+", r"i\sin\theta").to_edge(RIGHT, buff=0.5).shift(UP * 1.5)
        formula[2].set_color(RE_COL)
        formula[4].set_color(IM_COL)
        self.play(Write(formula))

        dot = Dot(p.c2p(1, 0), color=WALK_COL)
        arc = Arc(radius=1.35, start_angle=0, angle=PI, arc_center=p.c2p(0, 0), color=WALK_COL, stroke_width=6)
        self.play(GrowFromCenter(dot))
        self.play(Create(arc), MoveAlongPath(dot, arc), run_time=4, rate_func=smooth)
        minus_one = MathTex("-1", color=WALK_COL).next_to(p.c2p(-1, 0), DL, buff=0.1)
        theta = MathTex(r"\theta = \pi", color=WALK_COL).next_to(p.c2p(-0.75, 0.75), UL, buff=0.1)
        self.play(Write(minus_one), Write(theta))
        self.play(Flash(dot, color=WALK_COL))
        self.wait()


class Identity(MovingCameraScene):
    def construct(self):
        e1 = MathTex(r"e^{i\pi}", "=", r"\cos\pi", "+", r"i\sin\pi", font_size=64)
        e1[2].set_color(RE_COL)
        e1[4].set_color(IM_COL)
        self.play(Write(e1))
        self.wait()
        e2 = MathTex(r"e^{i\pi}", "=", "-1", "+", "0", font_size=64)
        e2[2].set_color(RE_COL)
        e2[4].set_color(IM_COL)
        self.play(TransformMatchingTex(e1, e2))
        self.wait()
        e3 = MathTex(r"e^{i\pi}", "+", "1", "=", "0", font_size=80)
        self.play(TransformMatchingTex(e2, e3), run_time=1.5)
        box = SurroundingRectangle(e3, color=WALK_COL, buff=0.3)
        self.play(Create(box))
        caption = Text("e, i, pi, 1 and 0 in one line", font_size=30).next_to(box, DOWN, buff=0.6)
        self.play(FadeIn(caption, shift=UP * 0.3))
        self.play(self.camera.frame.animate.scale(0.75), run_time=2)
        self.wait(1.5)
