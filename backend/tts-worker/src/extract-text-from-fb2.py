import xml.etree.ElementTree as ET

def extract_text_from_fb2(file_path, output_path):
    # Parse the FB2 file as an XML document
    tree = ET.parse(file_path)
    root = tree.getroot()

    # Namespace used in FB2 files
    namespace = {'fb2': 'http://www.gribuser.ru/xml/fictionbook/2.0'}

    # Find all paragraphs inside <body> tags
    paragraphs = root.findall(".//fb2:body//*", namespace)

    # Extract text and join with newlines
    text_content = "\n".join(paragraph.text for paragraph in paragraphs if paragraph.text)

    # Save the extracted text to a file
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(text_content)

    print("Text successfully extracted to {output_path}".format(output_path=output_path))

# Input FB2 file and output text file
input_fb2 = "assets/sample1.fb2"  # Replace with your FB2 file path
output_txt = "assets/sample1.txt"  # Output file for the text

extract_text_from_fb2(input_fb2, output_txt)