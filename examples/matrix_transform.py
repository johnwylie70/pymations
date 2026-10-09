# A real Manim Community script, unchanged. Run it:   pymations run matrix_transform.py
# Share it:   pymations build matrix_transform.py -o matrix_transform.html

from manim import *

# A 2x2 matrix acting on the plane: the grid and the basis vectors i-hat, j-hat move together.
# Uses ApplyPointwiseFunction (Manim's ApplyMatrix is not in our scope).

I_COL, J_COL = GREEN, RED


def shear(p):
    return [p[0] + p[1], p[1], p[2]]


def quarter_turn(p):
    return [-p[1], p[0], p[2]]


def make_plane():
    return NumberPlane(x_range=[-7, 7, 1], y_range=[-5, 5, 1], background_line_style={"stroke_opacity": 0.6})


def basis():
    return VGroup(Vector(RIGHT, color=I_COL), Vector(UP, color=J_COL))


def matrix_label(entries):
    m = Matrix(entries, h_buff=0.9).scale(0.8).to_corner(UL, buff=0.4)
    return VGroup(BackgroundRectangle(m, buff=0.15), m)


class Basis(Scene):
    def construct(self):
        plane = make_plane()
        self.play(Create(plane), run_time=2)
        vecs = basis()
        i_lab = MathTex(r"\hat\imath", color=I_COL).next_to(vecs[0], DOWN)
        j_lab = MathTex(r"\hat\jmath", color=J_COL).next_to(vecs[1], LEFT)
        self.play(GrowArrow(vecs[0]), GrowArrow(vecs[1]), Write(i_lab), Write(j_lab))
        self.wait()


class Shear(Scene):
    def construct(self):
        plane = make_plane()
        vecs = basis()
        self.add(plane, vecs)
        m = matrix_label([[1, 1], [0, 1]])
        self.play(FadeIn(m))
        self.play(
            ApplyPointwiseFunction(shear, plane),
            ApplyPointwiseFunction(shear, vecs),
            run_time=3,
        )
        note = Text("i-hat stays; j-hat lands on (1, 1)", font_size=28).to_edge(DOWN, buff=0.5)
        self.play(FadeIn(note, shift=UP * 0.3))
        self.wait()


class QuarterTurn(Scene):
    def construct(self):
        plane = make_plane()
        vecs = basis()
        self.add(plane, vecs)
        m = matrix_label([[0, -1], [1, 0]])
        self.play(FadeIn(m))
        self.play(
            ApplyPointwiseFunction(quarter_turn, plane),
            ApplyPointwiseFunction(quarter_turn, vecs),
            run_time=3,
        )
        note = Text("every point turns a quarter turn about the origin", font_size=28).to_edge(DOWN, buff=0.5)
        self.play(FadeIn(note, shift=UP * 0.3))
        self.wait()
