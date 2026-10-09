# A real Manim Community script, unchanged. Run it:   pymations run cycloid.py
# Share it:   pymations build cycloid.py -o cycloid.html

from manim import *

# Updaters: a circle rolls along a line; TracedPath draws the cycloid left by a point on its rim.

R = 0.8
X0 = -5.5
GROUND_Y = -1.5
WHEEL, RIM, TRACE = BLUE, YELLOW, ORANGE


class Rolling(Scene):
    def construct(self):
        title = Text("The cycloid", font_size=40).to_edge(UP)
        self.play(Write(title))
        ground = Line([-6.5, GROUND_Y, 0], [6.5, GROUND_Y, 0], color=GREY_B)
        self.play(Create(ground))

        t = ValueTracker(0)
        wheel = always_redraw(lambda: Circle(radius=R, color=WHEEL).move_to([X0 + R * t.get_value(), GROUND_Y + R, 0]))
        rim = always_redraw(
            lambda: Dot(
                [X0 + R * t.get_value() - R * np.sin(t.get_value()), GROUND_Y + R - R * np.cos(t.get_value()), 0],
                color=RIM,
            )
        )
        spoke = always_redraw(lambda: Line(wheel.get_center(), rim.get_center(), color=RIM, stroke_width=3))
        self.play(Create(wheel), FadeIn(rim), Create(spoke))

        trace = TracedPath(rim.get_center, stroke_color=TRACE, stroke_width=4)
        self.add(trace)
        self.play(t.animate.set_value(2 * TAU), run_time=8, rate_func=linear)
        self.wait()


class Equation(Scene):
    def construct(self):
        eq = MathTex(r"x(t) = r(t - \sin t)", r"\\", r"y(t) = r(1 - \cos t)", font_size=56)
        self.play(Write(eq), run_time=2)
        note = Text("one arch per turn of the wheel: length 8r", font_size=30).next_to(eq, DOWN, buff=0.8)
        self.play(FadeIn(note, shift=UP * 0.3))
        self.play(Indicate(eq[0]), Indicate(eq[2]))
        self.wait(1.5)
