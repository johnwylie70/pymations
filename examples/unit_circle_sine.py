# A real Manim Community script, unchanged. Run it:   pymations run unit_circle_sine.py
# Share it:   pymations build unit_circle_sine.py -o unit_circle_sine.html

from manim import *

# Explainer: a point going round the unit circle traces sine (its height) and cosine (its width) over time.

R = 1.2
CENTER = [-4.6, -0.3, 0]
SIN_COL, COS_COL, CIRCLE_COL = YELLOW, TEAL, BLUE


def circle_and_axes():
    circle = Circle(radius=R, color=CIRCLE_COL).move_to(CENTER)
    cross = VGroup(
        Line([CENTER[0] - R - 0.3, CENTER[1], 0], [CENTER[0] + R + 0.3, CENTER[1], 0], stroke_width=2),
        Line([CENTER[0], CENTER[1] - R - 0.3, 0], [CENTER[0], CENTER[1] + R + 0.3, 0], stroke_width=2),
    )
    ax = Axes(x_range=[0, TAU, PI / 2], y_range=[-1, 1, 0.5], x_length=TAU * R, y_length=2 * R, tips=False)
    ax.move_to([1.6, -0.3, 0])
    return circle, cross, ax


class Sine(Scene):
    def construct(self):
        title = Text("Where sine comes from", font_size=40).to_edge(UP)
        self.play(Write(title))
        circle, cross, ax = circle_and_axes()
        self.play(Create(cross), Create(circle), Create(ax), run_time=2)

        dot = Dot([CENTER[0] + R, CENTER[1], 0], color=SIN_COL)
        tracer = Dot(ax.c2p(0, 0), color=SIN_COL)
        wave = ax.plot(lambda t: np.sin(t), x_range=[0, TAU], color=SIN_COL)
        self.play(GrowFromCenter(dot), GrowFromCenter(tracer))
        self.play(
            MoveAlongPath(dot, circle),
            MoveAlongPath(tracer, wave),
            Create(wave),
            run_time=6,
            rate_func=linear,
        )
        label = MathTex(r"y = \sin\theta", color=SIN_COL).next_to(ax, UP)
        self.play(Write(label))
        self.wait()


class Cosine(Scene):
    def construct(self):
        circle, cross, ax = circle_and_axes()
        sine = ax.plot(lambda t: np.sin(t), x_range=[0, TAU], color=SIN_COL, stroke_opacity=0.35)
        self.add(cross, circle, ax, sine)

        dot = Dot([CENTER[0] + R, CENTER[1], 0], color=COS_COL)
        tracer = Dot(ax.c2p(0, 1), color=COS_COL)
        wave = ax.plot(lambda t: np.cos(t), x_range=[0, TAU], color=COS_COL)
        self.play(GrowFromCenter(dot), GrowFromCenter(tracer))
        self.play(
            MoveAlongPath(dot, circle),
            MoveAlongPath(tracer, wave),
            Create(wave),
            run_time=6,
            rate_func=linear,
        )
        label = MathTex(r"x = \cos\theta", color=COS_COL).next_to(ax, UP)
        self.play(Write(label))
        self.wait()


class Identity(Scene):
    def construct(self):
        eq = MathTex(r"\cos^2\theta", "+", r"\sin^2\theta", "=", "1", font_size=72)
        eq[0].set_color(COS_COL)
        eq[2].set_color(SIN_COL)
        why = Text("because the point stays on a circle of radius 1", font_size=30).next_to(eq, DOWN, buff=0.8)
        self.play(Write(eq), run_time=2)
        self.play(FadeIn(why, shift=UP * 0.3))
        self.play(Indicate(eq[4]))
        self.wait(2)
